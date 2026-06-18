# Bot Trading — Dashboard CRT Institucional

> Plataforma de trading con ejecución autónoma basada en la metodología **CRT (Candle Range Theory)** institucional, con dashboard en tiempo real y conexión nativa a MetaTrader 5.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 16, TypeScript, Zustand, Lightweight Charts, Tailwind CSS |
| Backend/Bridge | Python 3.x, `MetaTrader5`, `websockets`, `asyncio` |
| IA/Contexto | ChromaDB, SentenceTransformers (`all-MiniLM-L6-v2`) |

## Arquitectura

```
Frontend (Next.js)
    │  ws://127.0.0.1:8000
    ▼
mt5_bridge.py (WebSocket Server)  ◄──► MetaTrader 5 (terminal local)
    │
    ▼
context_engine.py (ChromaDB local)  ◄──► crt_rules_curated.md
```

## Inicio Rápido

```bash
# Terminal 1 — Frontend
npm install
npm run dev

# Terminal 2 — Backend (con MT5 abierto)
cd Bot-Trading
python mt5_bridge.py
```

Abrir [http://localhost:3000](http://localhost:3000).

## Documentación

Consultar [`RESUMEN_PROYECTO.md`](RESUMEN_PROYECTO.md) para la documentación técnica completa del proyecto.

## Licencia

MIT
