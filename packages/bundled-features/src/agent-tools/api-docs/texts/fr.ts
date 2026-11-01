import type { ApiDocsTexts } from "./types.ts";

export const frApiDocsTexts = {
  text: {
    "overview.title": "API HTTP",
    "overview.description":
      "Endpoints, corps de la requête, réponses, codes d'erreur, listes et lots de l'API HTTP.",
    "overview.intro":
      "Chaque appel est un POST avec un corps JSON. Le champ `type` nomme le handler, `payload` contient ses champs. Les pages de référence listent chaque handler avec ses champs.",
    "overview.endpoints.heading": "Endpoints",
    "overview.endpoints.query": "Lit des données. Ne modifie jamais rien.",
    "overview.endpoints.write":
      "Modifie des données : créer, mettre à jour, supprimer ou une action précise.",
    "overview.endpoints.batch": "Exécute plusieurs appels d'écriture dans une transaction.",
    "overview.auth.heading": "Authentification",
    "overview.auth.body":
      "Envoie un jeton d'API dans l'en-tête `Authorization` sous la forme `Bearer <token>`. Les requêtes avec jeton n'ont besoin ni de cookie ni de jeton CSRF. Le jeton fixe aussi le compte dans lequel la requête s'exécute, tu n'envoies donc jamais d'ID de compte ou de tenant.",
    "overview.body.heading": "Corps de la requête",
    "overview.body.body":
      "`type` est le nom du handler, par exemple `{exampleType}`. `payload` contient les champs de la référence. `requestId` est facultatif, voir plus bas. Le payload peut être imbriqué sur {maxDepth} niveaux au maximum.",
    "overview.responses.heading": "Réponses",
    "overview.responses.success":
      "Une lecture réussie renvoie `data`. Une écriture réussie renvoie `isSuccess: true` et `data`.",
    "overview.responses.error":
      "En cas d'échec, le statut HTTP est 4xx ou 5xx et le corps contient `error`. Les appels d'écriture renvoient aussi `isSuccess: false`. Appuie-toi sur `error.code` et le statut. `message` s'adresse aux personnes et peut changer.",
    "overview.errors.heading": "Codes d'erreur",
    "overview.errors.columns": "Code | Statut HTTP | Signification",
    "overview.versions.heading": "Versions et conflits",
    "overview.versions.body":
      "Chaque enregistrement a une `version`. Une mise à jour utilise la `version` que tu as lue en dernier. Si quelqu'un a modifié l'enregistrement entre-temps, l'appel échoue avec 409 `version_conflict`. Relis l'enregistrement, vérifie la modification et envoie-la avec la nouvelle version.",
    "overview.lists.heading": "Listes",
    "overview.lists.intro":
      "Les handlers de liste se terminent par `:list` et acceptent ces champs :",
    "overview.lists.columns": "Champ | Type | Description",
    "overview.lists.response":
      "La réponse contient `rows` et `nextCursor`. Pour la page suivante, envoie `nextCursor` comme `cursor`. Sur la dernière page, `nextCursor` vaut `null`.",
    "overview.batch.heading": "Lots",
    "overview.batch.body":
      "`POST /api/batch` prend `commands`, une liste d'appels d'écriture `{ type, payload }`. Ils s'exécutent dans une transaction : si l'un échoue, aucun n'a d'effet. La réponse contient alors `isSuccess: false`, l'`error` et `failedIndex`, la position de la commande en échec comptée à partir de 0.",
    "overview.retry.heading": "Réessayer sans risque",
    "overview.retry.body":
      "Envoie un `requestId` avec les appels d'écriture et de lot, une chaîne quelconque unique par modification. Si la connexion coupe et que tu renvoies le même appel avec le même `requestId`, tu reçois le premier résultat et la modification ne s'exécute pas deux fois.",
    "tokens.title": "Jetons d'API",
    "tokens.description":
      "Crée un jeton d'API pour {appName}, choisis ses scopes et envoie-le avec tes requêtes.",
    "tokens.intro":
      "Un jeton d'API permet à un script ou à un autre service d'appeler l'API de {appName} en ton nom. Ses scopes décident des données qu'il peut lire ou modifier.",
    "tokens.create.heading": "Créer un jeton",
    "tokens.create.step1": "Ouvre {menuPath}.",
    "tokens.create.step2": "Choisis **{createLabel}**.",
    "tokens.create.step3":
      "Saisis un nom, choisis les scopes et l'expiration, puis confirme avec ton mot de passe.",
    "tokens.create.step4":
      "Copie le jeton. Il commence par `kpat_` et n'est affiché qu'une seule fois.",
    "tokens.expiry":
      "Un jeton expire après {defaultDays} jours si tu ne choisis pas une autre expiration. L'expiration la plus longue possible est de {maxDays} jours.",
    "tokens.use.heading": "Utiliser le jeton",
    "tokens.use.body":
      "Envoie le jeton dans l'en-tête `Authorization`. Les requêtes avec jeton n'ont besoin ni de cookie ni de jeton CSRF.",
    "tokens.scopes.heading": "Scopes",
    "tokens.scopes.intro":
      "Chaque scope a deux niveaux. `read` autorise les handlers de lecture. `write` autorise tout ce que `read` autorise, plus les handlers d'écriture.",
    "tokens.scopes.columns": "Scope | Droit | Handlers",
    "tokens.rateLimit.heading": "Limite de requêtes",
    "tokens.rateLimit":
      "Chaque jeton peut envoyer {max} requêtes par tranche de {windowSeconds} secondes. Au-delà, l'API répond 429 `pat_rate_limited`.",
    "tokens.errors.heading": "Erreurs",
    "tokens.errors.columns": "Statut HTTP | Code | Cause",
    "tokens.errors.missing": "L'en-tête `Authorization` est absent.",
    "tokens.errors.invalid": "Le jeton est inconnu, révoqué ou expiré.",
    "tokens.errors.scope": "Il manque au jeton le scope pour ce handler.",
    "tokens.errors.route":
      "L'endpoint n'accepte pas les jetons. Les jetons ne fonctionnent que sur les endpoints de l'API.",
    "tokens.errors.rate": "Trop de requêtes avec ce jeton.",
    "tokens.errors.disabled": "Les jetons d'API ne font pas partie de ton offre.",
    "tokens.revoke.heading": "Révoquer un jeton",
    "tokens.revoke.body":
      "Révoque un jeton dans {menuPath} dès que tu ne l'utilises plus. Changer ton mot de passe révoque tous tes jetons. Un jeton agit toujours avec tes rôles actuels. Si tu quittes le compte ou si ton utilisateur est supprimé, il cesse de fonctionner.",
    "tokens.security.heading": "Sécurité",
    "tokens.security.item1":
      "Traite un jeton comme un mot de passe. Garde-le dans un coffre à secrets, pas dans le code ni dans un dépôt.",
    "tokens.security.item2":
      "Donne à chaque script son propre jeton, avec seulement les scopes dont il a besoin.",
    "tokens.security.item3": "Révoque les jetons que tu n'utilises plus.",
    "reference.description":
      "Référence de l'API pour {scopeLabel} : chaque handler avec ses champs et un exemple.",
    "reference.requiredScope": "Scope requis",
    "reference.endpoint": "Endpoint",
    "reference.fields.columns": "Champ | Type | Obligatoire | Description",
    "reference.yes": "oui",
    "reference.no": "non",
    "reference.noFields": "Ce handler ne prend aucun champ.",
    "reference.excluded": "Non modifiables via l'API : {fields}.",
    "reference.exampleRequest": "Exemple de requête",
    "reference.exampleResponse": "Exemple de réponse",
    "reference.status": "Statut : {status}",
  },
  errorMeanings: {
    validation_error:
      "Le payload ne correspond pas aux champs du handler. `details` nomme les champs.",
    unauthenticated: "Aucun identifiant valide n'a été envoyé.",
    missing_token: "L'en-tête `Authorization` est absent.",
    invalid_token: "Le jeton est inconnu, révoqué ou expiré.",
    ambiguous_auth:
      "La requête contenait un cookie de session et un jeton. N'envoie que l'un des deux.",
    access_denied:
      "Il manque au jeton le scope pour ce handler, ou l'endpoint n'accepte pas les jetons.",
    feature_disabled: "Cette fonction est désactivée ou ne fait pas partie de ton offre.",
    not_found: "L'enregistrement n'existe pas ou tu ne peux pas le voir.",
    conflict: "La modification est en conflit avec l'état actuel des données.",
    version_conflict:
      "L'enregistrement a changé après ta lecture. Relis-le et réessaie avec la nouvelle `version`.",
    precondition_failed:
      "Un champ de l'enregistrement n'a plus la valeur attendue par la modification. Relis l'enregistrement et réessaie.",
    record_locked: "Une autre modification verrouille l'enregistrement. Réessaie dans un instant.",
    idempotent_replay:
      "Cette modification a déjà été appliquée avec la même clé d'idempotence. La première tentative a réussi, ne l'envoie donc pas de nouveau.",
    unique_violation: "Un enregistrement avec cette valeur existe déjà.",
    unprocessable:
      "Les données sont valides, mais une règle métier refuse la modification. `details.reason` nomme la règle.",
    unconfigured:
      "Un réglage nécessaire à cette fonction est encore vide. Configure-le d'abord dans l'app, puis réessaie.",
    internal_error: "Erreur serveur inattendue. Réessaie plus tard.",
    member_read_timeout:
      "Une lecture sur le serveur a pris trop de temps et a été interrompue. Réessaie plus tard.",
    rate_limited:
      "Trop de requêtes. Attends le nombre de secondes indiqué par l'en-tête `Retry-After`.",
    rate_limit_unavailable:
      "La limitation de débit est temporairement indisponible, la requête a été refusée. Réessaie dans un instant.",
    pat_rate_limited:
      "Ce jeton a envoyé trop de requêtes en peu de temps. Attends un instant et réessaie.",
  },
  listParameters: {
    cursor: "Position issue de `nextCursor` de la page précédente.",
    limit: "Lignes par page, {default} par défaut, au maximum {max}.",
    search: "Recherche plein texte dans les champs interrogeables.",
    sort: "Champ servant au tri.",
    sortDirection: "`asc` ou `desc`.",
    offset: "Nombre de lignes à ignorer. Pour paginer, préfère `cursor`.",
    totalCount: "Avec `true`, tu reçois aussi `total`, le nombre de lignes correspondantes.",
    includeDeleted:
      "Avec `true`, les lignes supprimées sont incluses. Uniquement pour les entités avec suppression logique.",
    onlyDeleted:
      "Avec `true`, seules les lignes supprimées sont renvoyées. Uniquement pour les entités avec suppression logique, pas avec `includeDeleted`.",
    filter: "Un filtre de champ avec `field`, `op` et `value`. `op` est l'un de {ops}.",
    filters:
      "Plusieurs filtres de champ, chacun avec `field`, `op` et `value`. `op` est l'un de {ops}.",
    namedFilter: "Nom d'un filtre prédéfini de l'entité, par exemple une file de travail.",
    aggregate: "Renvoie des valeurs agrégées au lieu de lignes.",
  },
} as const satisfies ApiDocsTexts;
