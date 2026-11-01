import type { ApiDocsTexts } from "./types.ts";

export const esApiDocsTexts = {
  text: {
    "overview.title": "API HTTP",
    "overview.description":
      "Endpoints, cuerpo de la petición, respuestas, códigos de error, listas y lotes de la API HTTP.",
    "overview.intro":
      "Cada llamada es un POST con cuerpo JSON. El campo `type` nombra el handler y `payload` contiene sus campos. Las páginas de referencia listan cada handler con sus campos.",
    "overview.endpoints.heading": "Endpoints",
    "overview.endpoints.query": "Lee datos. Nunca cambia nada.",
    "overview.endpoints.write": "Cambia datos: crear, actualizar, eliminar o una acción concreta.",
    "overview.endpoints.batch": "Ejecuta varias llamadas de escritura en una transacción.",
    "overview.auth.heading": "Autenticación",
    "overview.auth.body":
      "Envía un token de API en la cabecera `Authorization` como `Bearer <token>`. Las peticiones con token no necesitan cookie ni token CSRF. El token también fija la cuenta en la que se ejecuta la petición, así que nunca envías un ID de cuenta o de tenant.",
    "overview.body.heading": "Cuerpo de la petición",
    "overview.body.body":
      "`type` es el nombre del handler, por ejemplo `{exampleType}`. `payload` contiene los campos de la referencia. `requestId` es opcional, ver más abajo. El payload puede anidarse como máximo {maxDepth} niveles.",
    "overview.responses.heading": "Respuestas",
    "overview.responses.success":
      "Una lectura correcta devuelve `data`. Una escritura correcta devuelve `isSuccess: true` y `data`.",
    "overview.responses.error":
      "Si falla, el estado HTTP es 4xx o 5xx y el cuerpo contiene `error`. Las llamadas de escritura devuelven además `isSuccess: false`. Decide según `error.code` y el estado. `message` está pensado para personas y puede cambiar.",
    "overview.errors.heading": "Códigos de error",
    "overview.errors.columns": "Código | Estado HTTP | Significado",
    "overview.versions.heading": "Versiones y conflictos",
    "overview.versions.body":
      "Cada registro tiene una `version`. Una actualización usa la `version` que leíste por última vez. Si alguien cambió el registro entretanto, la llamada falla con 409 `version_conflict`. Vuelve a leer el registro, revisa el cambio y envíalo con la nueva versión.",
    "overview.lists.heading": "Listas",
    "overview.lists.intro": "Los handlers de lista terminan en `:list` y aceptan estos campos:",
    "overview.lists.columns": "Campo | Tipo | Descripción",
    "overview.lists.response":
      "La respuesta contiene `rows` y `nextCursor`. Para la página siguiente envía `nextCursor` como `cursor`. En la última página `nextCursor` es `null`.",
    "overview.batch.heading": "Lotes",
    "overview.batch.body":
      "`POST /api/batch` recibe `commands`, una lista de llamadas de escritura `{ type, payload }`. Se ejecutan en una transacción: si una falla, ninguna surte efecto. La respuesta tiene entonces `isSuccess: false`, el `error` y `failedIndex`, la posición del comando fallido contada desde 0.",
    "overview.retry.heading": "Reintentos seguros",
    "overview.retry.body":
      "Envía un `requestId` en las llamadas de escritura y de lote, cualquier cadena única por cambio. Si se corta la conexión y vuelves a enviar la misma llamada con el mismo `requestId`, recibes el primer resultado y el cambio no se ejecuta dos veces.",
    "tokens.title": "Tokens de API",
    "tokens.description":
      "Crea un token de API para {appName}, elige sus scopes y envíalo con tus peticiones.",
    "tokens.intro":
      "Un token de API permite que un script u otro servicio llame a la API de {appName} en tu nombre. Sus scopes deciden qué datos puede leer o cambiar.",
    "tokens.create.heading": "Crear un token",
    "tokens.create.step1": "Abre {menuPath}.",
    "tokens.create.step2": "Elige **{createLabel}**.",
    "tokens.create.step3":
      "Introduce un nombre, elige los scopes y la caducidad, y confirma con tu contraseña.",
    "tokens.create.step4": "Copia el token. Empieza por `kpat_` y se muestra una sola vez.",
    "tokens.expiry":
      "Un token caduca a los {defaultDays} días si no eliges otra caducidad. La caducidad máxima posible es de {maxDays} días.",
    "tokens.use.heading": "Usar el token",
    "tokens.use.body":
      "Envía el token en la cabecera `Authorization`. Las peticiones con token no necesitan cookie ni token CSRF.",
    "tokens.scopes.heading": "Scopes",
    "tokens.scopes.intro":
      "Cada scope tiene dos niveles. `read` permite los handlers de lectura. `write` permite todo lo que permite `read` y además los handlers de escritura.",
    "tokens.scopes.columns": "Scope | Permiso | Handlers",
    "tokens.rateLimit.heading": "Límite de peticiones",
    "tokens.rateLimit":
      "Cada token puede enviar {max} peticiones cada {windowSeconds} segundos. Por encima, la API responde 429 `pat_rate_limited`.",
    "tokens.errors.heading": "Errores",
    "tokens.errors.columns": "Estado HTTP | Código | Causa",
    "tokens.errors.missing": "Falta la cabecera `Authorization`.",
    "tokens.errors.invalid": "El token es desconocido, está revocado o ha caducado.",
    "tokens.errors.scope": "Al token le falta el scope para este handler.",
    "tokens.errors.route":
      "El endpoint no acepta tokens. Los tokens solo funcionan en los endpoints de la API.",
    "tokens.errors.rate": "Demasiadas peticiones con este token.",
    "tokens.errors.disabled": "Los tokens de API no forman parte de tu plan.",
    "tokens.revoke.heading": "Revocar un token",
    "tokens.revoke.body":
      "Revoca un token en {menuPath} en cuanto dejes de usarlo. Al cambiar tu contraseña se revocan todos tus tokens. Un token actúa siempre con tus roles actuales. Si abandonas la cuenta o se elimina tu usuario, deja de funcionar.",
    "tokens.security.heading": "Seguridad",
    "tokens.security.item1":
      "Trata un token como una contraseña. Guárdalo en un almacén de secretos, no en el código ni en un repositorio.",
    "tokens.security.item2": "Da a cada script su propio token, solo con los scopes que necesita.",
    "tokens.security.item3": "Revoca los tokens que ya no uses.",
    "reference.description":
      "Referencia de la API para {scopeLabel}: cada handler con sus campos y un ejemplo.",
    "reference.requiredScope": "Scope necesario",
    "reference.endpoint": "Endpoint",
    "reference.fields.columns": "Campo | Tipo | Obligatorio | Descripción",
    "reference.yes": "sí",
    "reference.no": "no",
    "reference.noFields": "Este handler no recibe campos.",
    "reference.excluded": "No se pueden establecer mediante la API: {fields}.",
    "reference.exampleRequest": "Petición de ejemplo",
    "reference.exampleResponse": "Respuesta de ejemplo",
    "reference.status": "Estado: {status}",
    "events.title": "Eventos de webhook",
    "events.description":
      "Eventos de webhook: cuándo se envían, qué scope necesitan y qué contiene su carga.",
    "events.intro":
      "Un evento de webhook avisa a tu sistema de que algo ha cambiado. Cada evento tiene un nombre, una versión y una carga. El scope indicado en un evento es el scope de token que permite suscribirse a él.",
    "events.delivery.heading": "Entrega",
    "events.versions.heading": "Versiones",
    "events.versions.body":
      "Añadir un campo opcional mantiene la versión. Un cambio incompatible, como quitar o renombrar un campo o cambiar su tipo, recibe una versión nueva.",
    "events.list.heading": "Eventos",
    "events.version": "Versión",
    "events.requiredScope": "Scope necesario",
    "events.example": "Carga de ejemplo",
    "events.noFields": "Este evento no contiene campos.",
    "events.entity.created": "Se creó un registro de tipo {entity}.",
    "events.entity.updated": "Se actualizó un registro de tipo {entity}.",
    "events.entity.deleted": "Se eliminó un registro de tipo {entity}.",
  },
  errorMeanings: {
    validation_error:
      "El payload no coincide con los campos del handler. `details` nombra los campos.",
    unauthenticated: "No se enviaron credenciales válidas.",
    missing_token: "Falta la cabecera `Authorization`.",
    invalid_token: "El token es desconocido, está revocado o ha caducado.",
    ambiguous_auth: "La petición llevaba cookie de sesión y token. Envía solo uno de los dos.",
    access_denied: "Al token le falta el scope para este handler, o el endpoint no acepta tokens.",
    feature_disabled: "Esta función está desactivada o no forma parte de tu plan.",
    not_found: "El registro no existe o no puedes verlo.",
    conflict: "El cambio entra en conflicto con el estado actual de los datos.",
    version_conflict:
      "El registro cambió después de leerlo. Léelo de nuevo y reintenta con la nueva `version`.",
    precondition_failed:
      "Un campo del registro ya no tiene el valor que esperaba el cambio. Vuelve a leer el registro y reintenta.",
    record_locked: "Otro cambio bloquea el registro. Reintenta en un momento.",
    idempotent_replay:
      "Este cambio ya se aplicó con la misma clave de idempotencia. El primer intento tuvo éxito, así que no lo envíes otra vez.",
    unique_violation: "Ya existe un registro con este valor.",
    unprocessable:
      "Los datos son válidos, pero una regla de negocio rechaza el cambio. `details.reason` nombra la regla.",
    unconfigured:
      "Un ajuste que necesita esta función sigue vacío. Configúralo primero en la app y reintenta.",
    internal_error: "Error inesperado del servidor. Reintenta más tarde.",
    member_read_timeout:
      "Una lectura en el servidor tardó demasiado y se detuvo. Reintenta más tarde.",
    rate_limited:
      "Demasiadas peticiones. Espera los segundos que indica la cabecera `Retry-After`.",
    rate_limit_unavailable:
      "El límite de frecuencia no está disponible temporalmente y se rechazó la petición. Reintenta en un momento.",
    pat_rate_limited:
      "Este token envió demasiadas peticiones en poco tiempo. Espera un momento y reintenta.",
  },
  listParameters: {
    cursor: "Posición de `nextCursor` de la página anterior.",
    limit: "Filas por página, {default} por defecto, como máximo {max}.",
    search: "Búsqueda de texto completo en los campos con búsqueda.",
    sort: "Campo por el que ordenar.",
    sortDirection: "`asc` o `desc`.",
    offset: "Número de filas que se omiten. Para paginar es mejor `cursor`.",
    totalCount: "Con `true` recibes además `total`, el número de filas que coinciden.",
    includeDeleted:
      "Con `true` se incluyen las filas eliminadas. Solo para entidades con borrado lógico.",
    onlyDeleted:
      "Con `true` solo se devuelven las filas eliminadas. Solo para entidades con borrado lógico, no junto con `includeDeleted`.",
    filter: "Un filtro de campo con `field`, `op` y `value`. `op` es uno de {ops}.",
    filters: "Varios filtros de campo, cada uno con `field`, `op` y `value`. `op` es uno de {ops}.",
    namedFilter: "Nombre de un filtro predefinido de la entidad, por ejemplo una cola de trabajo.",
    aggregate: "Devuelve valores agregados en lugar de filas.",
  },
} as const satisfies ApiDocsTexts;
