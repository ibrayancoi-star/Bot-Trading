import os
import re
import uuid
import time
import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

# 1. Inicializar cliente local persistente de ChromaDB en la carpeta `./chroma_db`
DB_DIR = os.path.abspath("./chroma_db")
client = chromadb.PersistentClient(path=DB_DIR)

# 2. Utilizar el modelo de embedding 'sentence-transformers/all-MiniLM-L6-v2' de forma 100% local
emb_fn = SentenceTransformerEmbeddingFunction(model_name="sentence-transformers/all-MiniLM-L6-v2")

# 3. Crear o recuperar la colección "crt_knowledge"
collection = client.get_or_create_collection(
    name="crt_knowledge",
    embedding_function=emb_fn
)

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

def validate_market_context(setup_name: str, market_snapshot: str, chroma_threshold: float = 1.1, chroma_top_k: int = 2) -> dict:
    """
    Realiza una consulta por similitud combinando setup y market_snapshot.
    Recupera los resultados más cercanos (n_results=chroma_top_k).
    Si la distancia es < chroma_threshold y el fragmento es de tipo 'capa_3_exclusion' o contiene palabras
    como 'invalida', 'prohibido' o 'cancelar', devuelve:
      {"approved": False, "reason": "Motivo del bloqueo", "distance": float}
    De lo contrario, devuelve:
      {"approved": True, "reason": "Validación correcta", "distance": float}
    """
    query_text = f"Setup: {setup_name}. Market Context: {market_snapshot}"

    try:
        results = collection.query(
            query_texts=[query_text],
            n_results=chroma_top_k
        )
    except Exception as e:
        print(f"[ContextEngine] Error en la consulta de similitud: {e}")
        return {"approved": True, "reason": f"Error en consulta: {e}", "distance": 0.0}

    # Si no hay resultados de búsqueda, se aprueba por defecto
    if not results or not results["distances"] or len(results["distances"][0]) == 0:
        return {"approved": True, "reason": "No se encontraron reglas en la base vectorial", "distance": 0.0}

    min_distance = float(results["distances"][0][0])

    for i in range(len(results["distances"][0])):
        distance = float(results["distances"][0][i])
        metadata = results["metadatas"][0][i] if results["metadatas"] else {}
        document = results["documents"][0][i] if results["documents"] else ""

        meta_type = metadata.get("type", "") if metadata else ""
        doc_lower = document.lower()

        # Condición de bloqueo: distancia baja (< chroma_threshold) y
        # (tipo exclusion o palabras clave en el fragmento)
        is_exclusion = (meta_type == "capa_3_exclusion")
        has_block_keywords = any(kw in doc_lower for kw in ["invalida", "prohibido", "cancelar"])

        if distance < chroma_threshold and (is_exclusion or has_block_keywords):
            reason_msg = f"Regla/Bloqueo detectado: {metadata.get('title', 'Regla de exclusión')}."
            # Si el documento tiene palabras clave específicas o es una experiencia de pérdida
            if "loss" in doc_lower:
                reason_msg = f"Historial de pérdidas (LOSS): {document}"
            return {
                "approved": False,
                "reason": reason_msg,
                "distance": distance
            }

    return {
        "approved": True,
        "reason": "Validación correcta",
        "distance": min_distance
    }

def add_trade_experience(trade_data: dict):
    """
    Añade un registro semántico de la experiencia de un trade cerrado a la base vectorial.
    Recibe trade_data con: (symbol, type, outcome, pips_result, spread, setup_initial).
    Etiqueta la experiencia como 'capa_3_exclusion' si outcome es LOSS.
    """
    symbol = trade_data.get("symbol", "N/A")
    trade_type = trade_data.get("type", "N/A")
    outcome = str(trade_data.get("outcome", "N/A")).upper()
    pips_result = trade_data.get("pips_result", 0.0)
    spread = trade_data.get("spread", 0.0)
    setup_initial = trade_data.get("setup_initial", "N/A")

    # Redactar string semántico explicativo del resultado
    semantic_str = (
        f"Trade cerrado con resultado de {outcome} en el par {symbol} para la operación de {trade_type} "
        f"utilizando el setup inicial {setup_initial}. El trade resultó en {pips_result} pips de beneficio/pérdida "
        f"con un spread promedio de {spread} pips."
    )

    if outcome == "LOSS":
        semantic_str += (
            f" ATENCIÓN: El setup {setup_initial} falló en estas condiciones de mercado, resultando en pérdida (LOSS). "
            f"Este comportamiento invalida futuros setups similares bajo el mismo contexto. Se prohíbe operar "
            f"si las confluencias se asemejan a este trade."
        )
        meta_type = "capa_3_exclusion"
    else:
        semantic_str += f" El setup {setup_initial} se validó exitosamente con ganancias (WIN)."
        meta_type = "capa_2_semantica"

    # Generar ID única para la experiencia del trade
    exp_id = f"trade_experience_{outcome.lower()}_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    
    metadata = {
        "type": meta_type,
        "title": f"Trade Experience {outcome} - {symbol} - {setup_initial}",
        "symbol": symbol,
        "trade_type": trade_type,
        "outcome": outcome,
        "pips_result": float(pips_result),
        "spread": float(spread),
        "setup_initial": setup_initial,
        "timestamp": float(time.time()),
        "source": "execution_history"
    }

    collection.add(
        ids=[exp_id],
        documents=[semantic_str],
        metadatas=[metadata]
    )
    print(f"[ContextEngine] Experiencia de trade {outcome} agregada con ID {exp_id} bajo la etiqueta '{meta_type}'.")
    return {
        "id": exp_id,
        "document": semantic_str,
        "metadata": metadata
    }

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
