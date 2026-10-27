# WORKSHIFT AI — fase 1

Implementación local del núcleo World Model para O*NET 31.0. TypeScript, Node 22.13+ y SQLite (`node:sqlite`, experimental en Node 22). Sin dependencias de producción. No hay servidor HTTP ni frontend.

## Arquitectura y decisiones

Se sigue el patrón de Meterless World Model: esquema tipado → pipeline de ingesta → superficie de lectura/contexto. Agregado híbrido de observaciones y grafo. Las entidades tienen claves externas O*NET, atributos y procedencia; los contextos representan dataset + versión. Las relaciones son dirigidas y tienen atributos, contexto y una clave opcional para separar escalas IM/LV.

- `WorldStoreService`: acceso al log y a vistas de entidades/relaciones; vecinos del grafo.
- `IngestPipelineService`: normaliza, resuelve IDs, valida, anexa y expone vistas consistentes. Cada observación es transaccional. Un registro inválido de entrada se rechaza y deja traza; errores de almacenamiento abortan el lote para permitir reintento explícito.
- `ContextBuilderService`: prioriza IDs solicitados, luego vecinos; incluye procedencia e IDs de observaciones. Limita el JSON final por bytes UTF-8. No es un cálculo de tokens ni búsqueda vectorial.
- `WorldPersistence`: interfaz independiente de SQLite. Una futura implementación Postgres/Supabase debe conservar semántica transaccional, orden del log y unicidad. Supabase no se usa en esta fase.
- `SqliteWorldPersistence`: log append-only protegido por triggers, esquema `user_version=1`, índices por registro. Las vistas SQL se calculan desde el log; no existe estado derivado que deba repararse por separado. Lectura inmediata tras escritura.

IDs SHA-256 sobre claves canónicas: entidad = tipo + clave externa; contexto = dataset + versión; relación = origen + tipo + destino + contexto + discriminador. El contenido no cambia la identidad de la entidad. El ID de observación sí cambia con su contenido o versión de origen. `retrievedAt` se conserva en la primera observación, pero se excluye de deduplicación: descargar dos veces lo mismo no crea eventos. `sourceUpdatedAt`, cuando existe, participa en el hash.

Conflictos: gana la última observación nueva anexada, no el reloj del proveedor. Un contenido ya visto se considera duplicado incluso si reaparece después de un cambio; una reversión intencional requiere `sourceUpdatedAt` autoritativo nuevo. No usar un timestamp de descarga como revisión de origen.

Las entidades se mantienen a partir del historial completo; esta fase no implementa bajas de entidades. Las relaciones activas se derivan de la última observación por registro de origen, reconciliando relaciones retiradas. Si varias fuentes sostienen una misma relación, basta una observación activa para mantenerla. No hay merges probabilísticos ni aliases en esta fase; se resuelve exactamente por claves externas.

La reanudación consiste en repetir el lote: el log durable deduplica lo ya confirmado. No hay cursor remoto persistente ni planificador en segundo plano. Se esperan primero las ocupaciones y después las tareas/habilidades que las referencian. Extremos ausentes hacen fallar la transacción sin guardar observaciones parciales.

Trazas JSONL: UUID de ejecución, operación, resultado, ID de observación y cantidad de entidades. No guardan SQL, headers, tokens, prompts ni respuestas del proveedor. Las trazas son operativas; el log SQLite conserva la evidencia. Un fallo de traza se propaga después del commit; repetir la ingesta es seguro.

## Camino activo

`createWorkshift()` crea store, pipeline, contexto, adaptador Zetaris y Nightshift como proveedor principal. `ingestZetarisPage(sql, map)` conecta una consulta acotada con el pipeline mediante un mapper explícito suministrado tras confirmar el esquema; nunca deduce columnas de la respuesta. No hace solicitudes. `answer(intent, entityIds)` construye contexto y lo entrega a Nightshift como datos, con instrucciones de citar IDs. No existe fallback a otro proveedor.

`npm run demo` ejecuta ingesta → reingesta → contexto usando fixtures sintéticos. No invoca adaptadores. La prueba de aplicación recorre lectura HTTP simulada → ingesta SQLite → contexto → Nightshift simulado. Las pruebas HTTP usan `fetch` inyectado; no tienen acceso implícito a credenciales ni hacen tráfico real.

## Contrato Zetaris comprobado documentalmente

Fuente primaria fijada al commit `6a2fbaa47c32c9ac33f6584c64b43b146c621bed`:

https://github.com/zetaris/getting-started/blob/6a2fbaa47c32c9ac33f6584c64b43b146c621bed/scripts/zetaris_sql.py

`RestChannel.run` envía `POST /sql-editor/sqls/run` con `queryId` UUID, `sql`, `source: "SqlEditor"` y `limit`. Lee las filas en `data` como matriz. El cliente oficial usa Bearer, `X-Org-ID` y `X-Request-ID`.

El parser implementa solamente esa matriz de escalares y falla ante envelopes distintos, errores, filas inconsistentes o límites excedidos. No supone nombres de columnas, headers, query tokens ni paginación en la respuesta. La API antigua de la base de conocimiento utiliza otro endpoint y otro cuerpo; no se mezclan contratos.

Esto verifica el contrato publicado, **no la instalación 2.4.3.1**. Falta confirmar una respuesta real autorizada o una especificación de esa versión, sanitizada. Un rechazo del parser requiere revisar evidencia, no agregar formas supuestas.

SQL aceptado: `SELECT` de columnas simples o `*`, exclusivamente una de las tres tablas `WORKSHIFT_ONET`, `ORDER BY` opcional, `LIMIT 1..100`, `OFFSET 0..100000` opcional. OFFSET positivo exige ORDER BY; quien pagina debe proporcionar una combinación de claves única y estable. No soporta expresiones, joins, filtros, CTEs ni SQL arbitrario. Cada petición tiene timeout de 30 segundos y rechaza redirects. La API key debe tener permisos de solo lectura también en el servidor.

## Mapeo O*NET pendiente de esquema real

Las cantidades confirmadas por el usuario (1.016 ocupaciones, 18.838 tareas y 18.200 essential_skills) son contexto de origen; este proceso no las consultó ni cargó. No se adivinan columnas de esas tablas.

Para conectar la lectura con ingesta, inspeccionar y confirmar una proyección explícita y su orden de columnas, luego mapear cada fila al tipo `IngestRecord`:

- Ocupación: clave externa basada en código SOC; entidad `occupation` con título/descripción.
- Tarea: clave externa basada en task ID (y SOC si es necesario según el esquema); entidad `task`; relación `occupation → has_task → task`.
- Habilidad: clave basada en element ID; entidad `skill`; relación `occupation → requires_skill → skill`, con `key` de escala u otro discriminador real. Medidas de importancia/nivel en atributos de relación; no mezclar valores de escalas diferentes.
- Procedencia obligatoria: `kind: zetaris`, dataset, versión, tabla, clave compuesta de fila, fecha de recuperación y revisión autoritativa si existe.

`tests/fixtures/onet.ts` demuestra el formato normalizado. Sus IDs, nombres y valores son inventados para pruebas; no representan datos extraídos de O*NET.

## Referencias y alcance

Arquitectura oficial consultada el 2026-10-23:

- https://github.com/Meterless/World-Model/blob/main/AGENTS.md
- https://github.com/Meterless/World-Model/blob/main/docs/ingest-pipeline.md
- https://github.com/Meterless/World-Model/blob/main/docs/stable-ids.md
- https://github.com/Meterless/World-Model/blob/main/docs/read-surface.md
- https://www.meterless.ai/engines.html (contrato de proveedor Runtime/Nightshift).

El motor oficial es una especificación, no una librería instalada. Esta fase implementa su núcleo en el stack solicitado; no afirma certificación ni ejecución de la suite oficial de conformance, ni cubre el control plane, enriquecimiento con jobs, aliases o todas las vistas descritas. Esas extensiones no son necesarias para la ingesta estructurada inicial.
