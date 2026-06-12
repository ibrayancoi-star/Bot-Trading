import os
import re
import uuid
import time
import asyncio
import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

# 1. Inicializar cliente local persistente de ChromaDB en la carpeta `./chroma_db`
DB_DIR = os.path.abspath("./chroma_db")
client = chromadb.PersistentClient(path=DB_DIR)

# 2. Utilizar el modelo de embedding 'sentence-transformers/all-MiniLM-L6-v2' de forma 100% local
emb_fn = SentenceTransformerEmbeddingFunction(model_name="sentence-transformers/all-MiniLM-L6-v2")

# 3. Colección global de REGLAS curadas (crt_rules_curated.md). NO se elimina (backup).
#    Las experiencias de trade pasan a colecciones por símbolo (ver get_collection_for_symbol).
collection = client.get_or_create_collection(
    name="crt_knowledge",
    embedding_function=emb_fn
)


# [CHROMA-OPT-1] Colecciones por símbolo con distancia coseno
_symbol_collections: dict = {}

def get_collection_for_symbol(symbol: str):
    """Colección dedicada por símbolo (espacio coseno). Cacheada en proceso."""
    name = f"crt_knowledge_{symbol}"
    cached = _symbol_collections.get(name)
    if cached is not None:
        return cached
    col = client.get_or_create_collection(
        name=name,
        embedding_function=emb_fn,
        metadata={"hnsw:space": "cosine"}
    )
    _symbol_collections[name] = col
    return col


def migrate_to_symbol_collections():
    """
    [CHROMA-OPT-1] Migra experiencias de trade de la colección global a
    colecciones por símbolo. Idempotente: solo migra registros que aún no
    existan en la colección destino. La colección global NO se elimina (backup).
    Registros sin metadata 'symbol' se descartan.
    """
    try:
        res = collection.get(where={"source": "execution_history"})
    except Exception as e:
        print(f"[CHROMA] Migración omitida (sin colección global o error): {e}")
        return

    ids = res.get("ids") or []
    if not ids:
        print("[CHROMA] Migración: no hay experiencias en la colección global.")
        return

    docs = res.get("documents") or []
    metas = res.get("metadatas") or []
    per_symbol_counts: dict = {}

    for i in range(len(ids)):
        meta = metas[i] if i < len(metas) else None
        symbol = (meta or {}).get("symbol")
        if not symbol:
            continue  # sin symbol → se descarta
        target = get_collection_for_symbol(symbol)
        # Evitar duplicados: no reinsertar si el id ya existe en destino
        try:
            existing = target.get(ids=[ids[i]])
            if existing and existing.get("ids"):
                continue
        except Exception:
            pass
        target.add(
            ids=[ids[i]],
            documents=[docs[i] if i < len(docs) else ""],
            metadatas=[meta]
        )
        per_symbol_counts[symbol] = per_symbol_counts.get(symbol, 0) + 1

    if per_symbol_counts:
        resumen = ", ".join(f"{n} a {s}" for s, n in per_symbol_counts.items())
        print(f"[CHROMA] Migración: {resumen}")
    else:
        print("[CHROMA] Migración: 0 registros migrados (ya migrados o sin symbol).")

def initialize_vector_db(md_path="crt_rules_curated.md"):
    """
    Verifica si la colección ya tiene datos. Si no los tiene:
    - Lee el archivo crt_rules_curated.md.
    - Utiliza expresiones regulares para fragmentar el texto usando como separador los encabezados '## '.
    - Clasifica los metadatos de cada fragmento asignando {"type": "capa_1_determinista"},
      {"type": "capa_2_semantica"} o {"type": "capa_3_exclusion"} según palabras clave del título del bloque.
    - Guarda los fragmentos en ChromaDB de forma masiva (bulk insert).
    """
    # Verificar si la colección ya tiene datos
    count = collection.count()
    if count > 0:
        print(f"[ContextEngine] La colección ya cuenta con {count} registros. Se omite la inicialización.")
        return

    # Verificar existencia del archivo
    if not os.path.exists(md_path):
        print(f"[ContextEngine] Error: El archivo de reglas '{md_path}' no existe.")
        return

    # Leer el archivo de especificaciones de reglas
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Fragmentar utilizando la expresión regular con el separador '## '
    # Usamos (?:^|\n)##\s+ para capturar el inicio de línea con '## '
    raw_fragments = re.split(r'(?:^|\n)##\s+', content)

    documents = []
    metadatas = []
    ids = []

    for idx, fragment in enumerate(raw_fragments):
        fragment = fragment.strip()
        if not fragment:
            continue

        # Extraer el título del bloque como la primera línea del fragmento
        lines = fragment.splitlines()
        if not lines:
            continue
        title = lines[0].strip()
        title_lower = title.lower()

        # Clasificación por tipo según las palabras clave en el título
        if any(kw in title_lower for kw in ["capa 1", "determinista", "hard"]):
            meta_type = "capa_1_determinista"
        elif any(kw in title_lower for kw in ["capa 2", "semantica", "semántica", "soft"]):
            meta_type = "capa_2_semantica"
        elif any(kw in title_lower for kw in ["capa 3", "exclusion", "exclusión", "prohibido", "fallido"]):
            meta_type = "capa_3_exclusion"
        else:
            # Omitir fragmentos de introducción u otros que no coincidan con las categorías de capas
            continue

        documents.append(fragment)
        metadatas.append({
            "type": meta_type,
            "title": title
        })
        ids.append(f"rule_{meta_type}_{idx}")

    # Guardar masivamente en ChromaDB si existen fragmentos procesados
    if documents:
        collection.add(
            ids=ids,
            documents=documents,
            metadatas=metadatas
        )
        print(f"[ContextEngine] Base de datos vectorial inicializada correctamente con {len(documents)} reglas.")
    else:
        print("[ContextEngine] No se encontraron reglas válidas en el archivo para indexar.")

def validate_market_context(symbol: str, direction: str, sweep_type: str = None, killzone: str = None,
                            chroma_threshold: float = 1.1, chroma_top_k: int = 2) -> dict:
    """
    [CHROMA-OPT-3] Clasificación INFORMATIVA — NUNCA modifica el lotaje ni bloquea.
    Consulta la colección dedicada del símbolo (distancia coseno) con un query
    estructurado clave-valor, filtrando por symbol/direction en metadata.

    Retorna {"context": "NEW"|"WIN_MATCH"|"LOSS_MATCH", "approved": True,
             "distance": float, "reason": str}.

    'approved' es siempre True: la señal jamás se detiene por ChromaDB. El campo
    se mantiene por compatibilidad con los llamadores; el lotaje lo decide el usuario.
    """
    # [CHROMA-OPT-2] Query estructurado clave-valor
    query_text = (
        f"SYM:{symbol}|DIR:{direction}|"
        f"SWEEP:{sweep_type or 'NONE'}|KZ:{killzone or 'NONE'}"
    )

    try:
        col = get_collection_for_symbol(symbol)
        # [CHROMA-OPT-2] Filtro $and por symbol + direction (aislamiento estricto)
        results = col.query(
            query_texts=[query_text],
            n_results=chroma_top_k,
            where={"$and": [{"symbol": symbol}, {"trade_type": direction}]}
        )
    except Exception as e:
        print(f"[ContextEngine] Error en la consulta de similitud: {e}")
        return {"context": "NEW", "approved": True, "distance": 0.0, "reason": f"Error en consulta: {e}"}

    # Sin coincidencias → setup nuevo
    if not results or not results.get("distances") or len(results["distances"][0]) == 0:
        return {"context": "NEW", "approved": True, "distance": 0.0, "reason": "Sin experiencias previas similares"}

    min_distance = float(results["distances"][0][0])
    best_meta = (results["metadatas"][0][0] if results.get("metadatas") else {}) or {}
    outcome = str(best_meta.get("outcome", "")).upper()

    # Solo cuenta como match si la distancia es suficientemente cercana
    if min_distance < chroma_threshold and outcome in ("WIN", "LOSS"):
        context = "WIN_MATCH" if outcome == "WIN" else "LOSS_MATCH"
        reason = f"Experiencia previa {outcome} similar (dist={min_distance:.3f})"
    else:
        context = "NEW"
        reason = f"Sin match cercano (dist={min_distance:.3f})"

    return {"context": context, "approved": True, "distance": min_distance, "reason": reason}

def add_trade_experience(trade_data: dict):
    """
    Añade un registro semántico de la experiencia de un trade cerrado a la base vectorial.
    Recibe trade_data con: (symbol, type, outcome, pips_result, spread, setup_initial).
    Etiqueta la experiencia como 'capa_3_exclusion' si outcome es LOSS.
    """
    symbol = trade_data.get("symbol", "N/A")
    trade_type = str(trade_data.get("type", "N/A")).upper()
    outcome = str(trade_data.get("outcome", "N/A")).upper()
    pips_result = trade_data.get("pips_result", 0.0)
    spread = trade_data.get("spread", 0.0)
    setup_initial = trade_data.get("setup_initial", "N/A")
    sweep_type = trade_data.get("sweep_type")
    killzone = trade_data.get("killzone")

    # [CHROMA-OPT-2] Texto estructurado clave-valor (mismo formato que la query)
    doc_text = (
        f"SYM:{symbol}|DIR:{trade_type}|RESULT:{outcome}|"
        f"SWEEP:{sweep_type or 'NONE'}|KZ:{killzone or 'NONE'}|"
        f"PIPS:{round(float(pips_result), 1)}|SPREAD:{round(float(spread), 1)}"
    )

    meta_type = "capa_3_exclusion" if outcome == "LOSS" else "capa_2_semantica"

    # Generar ID única para la experiencia del trade
    exp_id = f"trade_experience_{outcome.lower()}_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    metadata = {
        "type": meta_type,
        "title": f"Trade Experience {outcome} - {symbol} - {setup_initial}",
        "symbol": symbol,
        "trade_type": trade_type,
        "outcome": outcome,
        "sweep_type": sweep_type or "NONE",
        "killzone": killzone or "NONE",
        "pips_result": float(pips_result),
        "spread": float(spread),
        "setup_initial": setup_initial,
        "timestamp": float(time.time()),
        "source": "execution_history"
    }

    # [CHROMA-OPT-1] Guardar en la colección dedicada del símbolo
    col = get_collection_for_symbol(symbol)
    col.add(
        ids=[exp_id],
        documents=[doc_text],
        metadatas=[metadata]
    )
    print(f"[ContextEngine] Experiencia de trade {outcome} agregada a 'crt_knowledge_{symbol}' con ID {exp_id}.")
    return {
        "id": exp_id,
        "document": doc_text,
        "metadata": metadata
    }


# [CHROMA-OPT-4] Wrappers no bloqueantes (operaciones ChromaDB en hilo secundario)
async def add_trade_experience_async(*args, **kwargs):
    return await asyncio.to_thread(add_trade_experience, *args, **kwargs)

async def validate_market_context_async(*args, **kwargs):
    return await asyncio.to_thread(validate_market_context, *args, **kwargs)

def get_historical_trades_text(limit=20) -> list:
    """
    Consulta la colección de ChromaDB buscando registros de operaciones guardadas,
    filtrando por {"source": "execution_history"}. Retorna las últimas experiencias (por defecto 20).
    """
    try:
        # Consultamos todos los que tengan source: execution_history
        res = collection.get(
            where={"source": "execution_history"}
        )
        trades = []
        if res and "metadatas" in res and res["metadatas"]:
            for i in range(len(res["ids"])):
                meta = res["metadatas"][i]
                doc = res["documents"][i] if res["documents"] else ""
                trades.append({
                    "id": res["ids"][i],
                    "texto": doc,
                    "tipo_meta": meta.get("type", "execution_history") if meta else "execution_history",
                    "timestamp": meta.get("timestamp", 0.0) if meta else 0.0,
                    "document": doc,
                    "metadata": meta
                })
        
        # Fallback para registros de trades antiguos que no tengan el tag "source"
        if not trades:
            res_excl = collection.get(where={"type": "capa_3_exclusion"})
            res_sem = collection.get(where={"type": "capa_2_semantica"})
            
            all_res = []
            for r in [res_excl, res_sem]:
                if r and "metadatas" in r and r["metadatas"]:
                    for i in range(len(r["ids"])):
                        meta = r["metadatas"][i]
                        if meta and "Trade Experience" in meta.get("title", ""):
                            doc = r["documents"][i] if r["documents"] else ""
                            all_res.append({
                                "id": r["ids"][i],
                                "texto": doc,
                                "tipo_meta": meta.get("type", "execution_history") if meta else "execution_history",
                                "timestamp": meta.get("timestamp", 0.0) if meta else 0.0,
                                "document": doc,
                                "metadata": meta
                            })
            trades = all_res

        # Ordenar por timestamp descendente (más recientes primero)
        trades.sort(key=lambda x: x.get("timestamp", 0.0), reverse=True)
        return trades[:limit]
    except Exception as e:
        print(f"[ContextEngine] Error al obtener historial de trades: {e}")
        return []
