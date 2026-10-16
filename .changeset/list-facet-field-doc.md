---
"@cosmicdrift/kumiko-types": patch
---

ListFacetSpec docs state that reference facets are exempt from the declared-column rule

<!-- kumiko-changes
feature: framework
type: improvement
title: Facet field docs name the reference exception
detail: The docs of projectionList.facets and relatedList.facets said every facet field must be a declared column. A facet of type "reference" is exempt: it filters by id through the bound query's filters and needs a registered entity instead. Behavior is unchanged.
-->
