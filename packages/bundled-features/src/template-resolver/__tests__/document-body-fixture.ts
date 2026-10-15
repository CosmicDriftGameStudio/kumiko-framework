// Canonical form: exactly what documentExtensions serialize to.
export const documentBodyFixture = [
  "<h1>Title</h1>",
  "<h2>Section</h2>",
  "<h3>Sub</h3>",
  "<p>Hello <strong>bold</strong> and <em>italic</em><br>next line</p>",
  "<ul><li><p>one</p></li><li><p>two</p></li></ul>",
  "<ol><li><p>first</p></li></ol>",
  '<p><a href="https://example.com/a">site</a> <a href="{{unsubscribeUrl}}">unsubscribe</a></p>',
  '<p>Dear <span data-variable="customer.name"></span></p>',
  '<img data-resource="logo" alt="Company logo">',
  '<a data-button="" href="{{confirmUrl}}">Bestätigen</a>',
  "<hr>",
  '<div data-page-break=""></div>',
  '<table><tbody><tr><th><p>Item</p></th><th><p>Price</p></th></tr><tr data-each="items" data-repeat-header=""><td><p><span data-variable="name"></span></p></td><td><p>x</p></td></tr></tbody></table>',
].join("");
