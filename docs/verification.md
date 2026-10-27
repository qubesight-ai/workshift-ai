# Verificación de fase 1 — 2026-10-23

Entorno: `/opt/workshift-ai`, Node 22.22.1, TypeScript 5.9.3. Sin dependencias de producción; tipos Node y TypeScript en desarrollo con lockfile.

## Resultados ejecutados

- `npm test`: compilación estricta correcta, **21 pruebas aprobadas, 0 fallos, 0 omitidas**.
- 12 casos HTTP/contrato con fixtures sintéticos.
- 8 casos World Model con SQLite real y entradas sintéticas.
- 1 caso completo de aplicación con lectura Zetaris simulada, persistencia SQLite real, contexto y respuesta Nightshift simulada.
- `npm run demo`: ejecutado sin credenciales; 3 observaciones anexadas, segunda pasada con 0 nuevas y 3 duplicadas; contexto con 3 entidades y 2 relaciones.

La demo inicial quedó en `artifacts/fixture-demo-5F6cNY/` con `world.sqlite` y `trace.jsonl`. Cada ejecución crea un directorio nuevo. Los artefactos son ignorados por Git y no contienen datos reales de O*NET.

El comando de pruebas usa `--experimental-test-isolation=none`: en este entorno el aislamiento por subprocesos reportaba solamente los archivos. Se verificó también la ejecución directa de ambos archivos de componentes; el comando final muestra los 21 casos individualmente. SQLite emite su advertencia experimental de Node 22.

## Evidencia y límites

| Componente | Evidencia | Estado real |
|---|---|---|
| Persistencia | SQLite en disco, reapertura, historial y vistas reconstruidas | Funcional localmente |
| Ingesta | Dedupe, timestamps de recuperación, cambios, concurrencia, rollback y reconciliación | Probada con entradas sintéticas |
| Contexto | Selección por grafo, procedencia, ausencia de extremos huérfanos y presupuesto UTF-8 | Probado con entradas sintéticas |
| Zetaris REST | Contrato leído del cliente oficial; mocks del endpoint, headers, payload y parser | No conectado a la instancia |
| Nightshift | Mocks de discovery/chat, modelos desconocidos, auth, errores y respuesta textual | No conectado al runtime |
| O*NET real | Solo contexto aportado por el usuario | No se leyó ni importó en esta ejecución |

No se ejecutó conformance oficial completa de Meterless. Las referencias y los elementos fuera de fase están en `architecture.md`.

No se realizaron conexiones autenticadas reales a Zetaris ni Nightshift. No se inspeccionaron secretos de Zetaris ni se modificaron archivos de su instalación, contenedores, puertos, firewall o servicios públicos.

Faltan credenciales genuinas (`ZETARIS_API_KEY`, `ZETARIS_ORG_ID`, `METERLESS_RUNTIME_TOKEN`), confirmar URL/modelo de Nightshift, validar el contrato contra Zetaris 2.4.3.1 y proporcionar el mapper de columnas reales O*NET. Se requiere una petición autenticada real de discovery y otra de inferencia antes de afirmar que Nightshift funciona.
