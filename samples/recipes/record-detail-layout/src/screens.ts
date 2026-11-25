import { createFileField, type ScreenDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { accessRoles, ORDER_LIST_QUERY } from "./order-board.ts";

export const ordersScreen: ScreenDefinition = {
  id: "orders",
  type: "projectionList",
  query: ORDER_LIST_QUERY,
  rowToneField: "tone",
  columns: [
    { field: "orderNumber", label: "order-desk.col.order" },
    { field: "customerName", label: "order-desk.col.customer", hideOnNarrow: true },
    {
      field: "urgencyLabel",
      label: "order-desk.col.urgency",
      display: "badge",
      badgeToneField: "urgencyTone",
    },
    {
      field: "nextStep",
      label: "order-desk.col.todo",
      hint: {
        detailField: "nextStepDue",
        narrowDetailField: "nextStepShort",
        reasonField: "nextStepReason",
        reasonTitleField: "nextStepReasonTitle",
        reasonOpenField: "nextStepReasonOpen",
        emptyLabel: "order-desk.orders.nothing-open",
      },
      width: 320,
      minWidth: 240,
    },
    { field: "openAmount", label: "order-desk.col.open-amount", hideOnNarrow: true },
    {
      field: "narrowOpen",
      label: "order-desk.col.narrow-open",
      showOnNarrowOnly: true,
      narrowInline: true,
    },
    {
      field: "narrowStatus",
      label: "order-desk.col.narrow-status",
      showOnNarrowOnly: true,
      narrowInline: true,
    },
  ],
  defaultSort: { field: "urgency", dir: "desc" },
  toolbarSort: true,
  sortOptions: [
    { field: "urgency", dir: "desc", label: "order-desk.sort.urgency" },
    { field: "customerName", dir: "asc", label: "order-desk.sort.customer" },
  ],
  namedFilters: [
    {
      id: "action-needed",
      label: "order-desk.filter.action-needed",
      sort: { field: "urgency", dir: "desc" },
      emptyState: {
        title: "order-desk.orders.all-done",
        description: "order-desk.orders.all-done-hint",
      },
    },
    {
      id: "reminder-due",
      label: "order-desk.filter.reminder-due",
      emptyState: {
        title: "order-desk.orders.all-done",
        description: "order-desk.orders.next-reminder",
        paramsQuery: "order-desk:query:order:next-reminder",
      },
    },
    { id: "ending-soon", label: "order-desk.filter.ending-soon" },
  ],
  namedFilterFacet: {
    display: "select",
    showCounts: true,
    label: "order-desk.orders.todo",
    narrowPlacement: "behind-filter",
  },
  narrowFacets: "pills",
  table: {
    frame: "card",
    summaryRow: { query: "order-desk:query:order:summary" },
  },
  rowActions: [
    {
      kind: "navigate",
      id: "open",
      label: "order-desk.action.open",
      screen: "order-detail",
      rowClick: true,
    },
    {
      id: "remind",
      label: "order-desk.action.remind",
      handler: "order-desk:write:order:remind",
      display: "button",
      visible: { field: "canRemind", eq: true },
    },
    {
      kind: "navigate",
      id: "open-order",
      label: "order-desk.action.open-order",
      screen: "order-detail",
      display: "button",
      visible: { field: "canRemind", eq: false },
    },
    {
      // The whole detail in a popup: 24px from every window edge, no title bar of its own.
      kind: "drawer",
      id: "quick-view",
      label: "order-desk.action.quick-view",
      screen: "order-detail",
      width: "popup",
      display: "button",
      // Pressed while the reminder is already sent.
      active: { when: { field: "canRemind", eq: false } },
    },
    {
      kind: "drawer",
      id: "remind-note",
      label: "order-desk.action.remind-note",
      screen: "order-remind",
      width: "wide",
      back: true,
      title: "order-desk.drawer.remind-title",
      subtitle: "order-desk.drawer.remind-subtitle",
      // Only feeds the heading placeholders; the form does not declare these fields.
      headingFields: ["orderNumber", "customerName"],
      params: { pick: ["id"] },
    },
  ],
  access: accessRoles,
};

export const todayScreen: ScreenDefinition = {
  id: "today",
  type: "dashboard",
  panels: [
    {
      kind: "text",
      id: "briefing",
      span: "two-thirds",
      narrowOrder: 1,
      query: "order-desk:query:order:briefing",
    },
    {
      kind: "stat-group",
      id: "queue-counts",
      label: "order-desk.today.inbox",
      subtitle: "order-desk.today.inbox-sub",
      span: "full",
      layout: "strip",
      icon: { react: { __component: "OrderInboxIcon" } },
      link: { label: "order-desk.today.inbox-link", screen: "orders" },
      stats: [
        {
          kind: "stat",
          id: "action-needed",
          label: "order-desk.today.stat.action-needed",
          query: ORDER_LIST_QUERY,
          valueField: "total",
          params: { namedFilter: "action-needed", limit: 1, totalCount: true },
          tone: "negative",
          navigate: { screen: "orders", namedFilter: "action-needed" },
        },
        {
          kind: "stat",
          id: "reminder-due",
          label: "order-desk.today.stat.reminder-due",
          query: ORDER_LIST_QUERY,
          valueField: "total",
          params: { namedFilter: "reminder-due", limit: 1, totalCount: true },
          tone: "warn",
          navigate: { screen: "orders", namedFilter: "reminder-due" },
        },
        {
          kind: "stat",
          id: "ending-soon",
          label: "order-desk.today.stat.ending-soon",
          query: ORDER_LIST_QUERY,
          valueField: "total",
          params: { namedFilter: "ending-soon", limit: 1, totalCount: true },
          navigate: { screen: "orders", namedFilter: "ending-soon" },
        },
      ],
    },
    {
      kind: "list",
      id: "now",
      label: "order-desk.today.now",
      span: "two-thirds",
      showHeader: false,
      showTotal: {
        text: "order-desk.today.now-total",
        narrowText: "order-desk.today.now-total-narrow",
      },
      narrow: { layout: "cards", limit: 3 },
      footerLink: {
        label: "order-desk.today.now-all",
        screen: "orders",
        namedFilter: "action-needed",
      },
      query: "order-desk:query:order:now",
      rowToneField: "tone",
      columns: [
        { field: "urgencyLabel", display: "badge", badgeToneField: "urgencyTone" },
        {
          field: "nextStep",
          hint: {
            detailField: "nextStepDue",
            narrowDetailField: "nextStepShort",
            reasonField: "nextStepReason",
            reasonTitleField: "nextStepReasonTitle",
            reasonOpenField: "nextStepReasonOpen",
            plainSentence: true,
          },
        },
        {
          field: "actionLabel",
          display: "button",
          linkScreenField: "actionScreen",
          linkParamsField: "actionParams",
        },
      ],
    },
    {
      kind: "list",
      id: "deadlines",
      label: "order-desk.today.deadlines",
      span: "third",
      showHeader: false,
      icon: { react: { __component: "DeadlinesIcon" } },
      narrow: {
        layout: "line",
        field: "title",
        moreText: "order-desk.today.deadlines-more-narrow",
      },
      rowLink: { screenField: "screen", paramsField: "params", icon: "chevron" },
      footerLink: {
        narrowOnly: true,
        label: "order-desk.today.deadlines-all",
        moreText: "order-desk.today.deadlines-more",
        narrowMoreText: "order-desk.today.deadlines-more-narrow",
        screen: "orders",
      },
      query: "order-desk:query:order:deadlines",
      columns: [{ field: "due", display: "datetime" }, { field: "title" }],
    },
    {
      kind: "list",
      id: "customers",
      label: "order-desk.today.customers",
      span: "third",
      showHeader: false,
      hideOnNarrow: true,
      rowLink: { screen: "order-detail", paramField: "params" },
      query: "order-desk:query:order:customers",
      rowToneField: "tone",
      rowToneMarker: "dot",
      columns: [
        { field: "customerName" },
        { field: "openCount", display: "badge", badgeToneField: "openTone" },
      ],
    },
    {
      kind: "stat-group",
      id: "money",
      label: "order-desk.today.money",
      subtitle: "order-desk.today.money-sub",
      span: "two-thirds",
      layout: "cards",
      columns: 3,
      hideOnNarrow: true,
      stats: [
        {
          kind: "stat",
          id: "open",
          label: "order-desk.today.stat.open",
          query: "order-desk:query:order:money",
          valueField: "open",
        },
        {
          kind: "stat",
          id: "overdue",
          label: "order-desk.today.stat.overdue",
          query: "order-desk:query:order:money",
          valueField: "overdue",
          tone: "negative",
        },
        {
          kind: "stat",
          id: "collected",
          label: "order-desk.today.stat.collected",
          query: "order-desk:query:order:money",
          valueField: "collected",
          tone: "positive",
        },
      ],
    },
  ],
  access: accessRoles,
};

export const orderDetailScreen: ScreenDefinition = {
  id: "order-detail",
  type: "projectionDetail",
  query: "order-desk:query:order:detail",
  focus: true,
  listScreenId: "orders",
  header: {
    title: "customerName",
    shortTitle: "shortTitle",
    narrowTitle: "order-desk.header.narrow-title",
    // Parts are joined by a separator; `format` formats the raw field value.
    narrowSubtitle: "narrowSubtitle",
    subtitle: [
      "orderNumber",
      { field: "placedAt", format: { format: "date", dateStyle: "medium" } },
    ],
    status: "status",
    // A second badge beside `status`; it resolves its text and tone the same way.
    secondaryStatus: "totalNote",
  },
  breadcrumb: { field: "path" },
  summary: { field: "summaryLine", narrowField: "summaryShort", toneField: "summaryTone" },
  banner: {
    field: "notice",
    iconless: true,
    actions: [
      {
        kind: "navigate",
        id: "banner-open",
        label: "order-desk.action.recordPayment",
        screen: "order-detail",
        icon: "plus",
        hideIcon: true,
        narrowLabel: "order-desk.action.record-short",
      },
    ],
  },
  progress: { field: "progress", placement: "beside-steps", hideOnNarrow: true },
  steps: {
    field: "steps",
    narrowLimit: 3,
    title: "order-desk.steps.title",
    emptyLabel: "order-desk.steps.empty",
    actions: [
      {
        kind: "navigate",
        id: "step-open",
        label: "order-desk.action.refreshOrder",
        screen: "order-detail",
        icon: "refresh",
      },
      {
        kind: "navigate",
        id: "prepare",
        label: "order-desk.action.prepare",
        screen: "order-detail",
        display: "link",
        icon: "sparkles",
        visible: { field: "canPrepare", eq: true },
      },
    ],
  },
  mobileSummary: "mobileLine",
  metricsStyle: "tiles",
  metricsPlacement: { narrow: "before-steps" },
  metrics: [
    {
      field: "totalAmount",
      label: "order-desk.metric.totalAmount",
      subField: "totalNote",
    },
    {
      field: "outstandingAmount",
      label: "order-desk.metric.outstandingAmount",
      labelField: "outstandingLabel",
      subField: "outstandingNote",
      tone: "warn",
      toneField: "outstandingTone",
      visibleWhen: { field: "status", ne: "delivered" },
      navigate: { tab: "payments" },
    },
    {
      field: "itemCount",
      label: "order-desk.metric.itemCount",
      navigate: { tab: "items" },
    },
    { field: "placedAt", label: "order-desk.metric.placedAt", hideOnNarrow: true },
  ],
  layout: {
    mode: "tabs",
    sections: [
      {
        id: "items",
        kind: "relatedList",
        title: "order-desk.tab.items",
        countField: "itemsCount",
        after: { react: { __component: "OrderItemsFooter" } },
        query: "order-desk:query:order:items",
        columns: [
          { field: "sku", label: "order-desk.col.sku" },
          { field: "description", label: "order-desk.col.description" },
          { field: "quantity", label: "order-desk.col.quantity" },
          {
            field: "unitPrice",
            label: "order-desk.col.unit-price",
            renderer: { format: "currency", currency: "EUR" },
          },
        ],
      },
      {
        id: "payments",
        kind: "relatedList",
        title: "order-desk.tab.payments",
        countField: "paymentsCount",
        query: "order-desk:query:order:payments",
        // First matching rule wins.
        // No row actions while the order has no payment.
        rowActionsWhen: { field: "paymentsCount", ne: 0 },
        rowTone: [
          // `fill` tints the row (4 % of the tone) and draws no stripe.
          { field: "status", eq: "pending", tone: "warn", fill: true },
          { field: "status", eq: "settled", tone: "ok" },
        ],
        columns: [
          { field: "paidAt", label: "order-desk.col.paid-at" },
          {
            field: "amount",
            label: "order-desk.col.amount",
            renderer: { format: "currency", currency: "EUR" },
          },
          { field: "method", label: "order-desk.col.method" },
          { field: "status", label: "order-desk.col.status" },
        ],
        emptyState: {
          title: "order-desk.payments.empty",
          variants: [
            {
              when: { field: "status", eq: "pending" },
              title: "order-desk.payments.empty-pending",
            },
          ],
        },
      },
      {
        id: "attach",
        kind: "writeForm",
        title: "order-desk.tab.attach",
        fieldDefs: { attachment: createFileField() },
        // The upload is stored as this entity's file field, so the handler can bind it.
        uploadEntity: "order-attachment",
        fields: ["attachment"],
        handler: "order-desk:write:order:attach",
      },
      {
        id: "details",
        kind: "fields",
        title: "order-desk.tab.details",
        fields: [
          "shippingAddress",
          { field: "billingAddress", concealed: true },
          {
            field: "salesRep",
            // Buttons beside the value; they run against the enclosing record and show
            // even when the value is empty.
            actions: [
              {
                kind: "navigate",
                id: "refresh-rep",
                label: "order-desk.action.refreshOrder",
                screen: "order-detail",
                icon: "refresh",
                display: "icon",
                style: "secondary",
              },
            ],
          },
        ],
      },
      {
        id: "internal-note",
        kind: "extension",
        hideOnNarrow: true,
        title: "order-desk.tab.internalNote",
        component: { react: { __component: "OrderInternalNote" } },
        entityName: "order",
      },
    ],
  },
  actions: [
    {
      kind: "navigate",
      id: "refresh-order",
      label: "order-desk.action.refreshOrder",
      screen: "order-detail",
      icon: "refresh",
    },
    {
      kind: "navigate",
      id: "download-invoice",
      label: "order-desk.action.downloadInvoice",
      screen: "order-detail",
      icon: "download",
      // Shown but not clickable until the order has a payment.
      disabled: { field: "paymentsCount", eq: 0 },
    },
    {
      kind: "navigate",
      id: "record-payment",
      label: "order-desk.action.recordPayment",
      screen: "order-detail",
      icon: "plus",
      showOnTabs: ["payments"],
    },
  ],
  inlineActions: ["download-invoice"],
  access: accessRoles,
};

export const orderFactsScreen: ScreenDefinition = {
  id: "order-facts",
  type: "projectionDetail",
  query: "order-desk:query:order:detail",
  listScreenId: "orders",
  header: { title: "customerName" },
  // Two short stacked sections need no "On this page" index.
  pageNavigation: false,
  layout: {
    sections: [
      {
        id: "contact",
        kind: "fields",
        title: "order-desk.facts.contact",
        fields: ["salesRep"],
      },
      {
        id: "address",
        kind: "fields",
        title: "order-desk.facts.address",
        fields: ["shippingAddress", "billingAddress"],
      },
    ],
  },
  access: accessRoles,
};

export const orderRemindScreen: ScreenDefinition = {
  id: "order-remind",
  type: "actionForm",
  handler: "order-desk:write:order:remind",
  fields: { id: { type: "text" } },
  layout: { sections: [{ fields: [{ field: "id", readOnly: true }] }] },
};
