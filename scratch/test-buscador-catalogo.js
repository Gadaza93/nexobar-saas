// scratch/test-buscador-catalogo.js
// Buscador y filtros de Productos e Inventario (modules.js): sin tildes ni mayúsculas, todas las palabras
// en cualquier orden, y la lista de categorías sin la seudo categoría «Todos» del punto de venta.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'modules.js'), 'utf8');
const ini = src.indexOf('// Buscador y filtros de Productos e Inventario'), fin = src.indexOf('function renderProducts() {');
assert.ok(ini > 0 && fin > ini, 'Bloque del buscador en modules.js');
const ctx = { state: { categories: ['Todos', 'Licores', 'Cervezas'], products: [{ category: 'Comidas' }, { category: '' }] } };
vm.createContext(ctx);
vm.runInContext(src.slice(ini, fin) + '; globalThis.api = { matchesSearch, catalogCategories };', ctx);
const { matchesSearch, catalogCategories } = ctx.api;

assert.ok(matchesSearch('Ron Medellín Añejo 8 Años', 'anejo ron'), 'Sin tildes y en cualquier orden');
assert.ok(matchesSearch('Cerveza Águila Light', 'AGUILA'), 'Sin mayúsculas');
assert.ok(matchesSearch('Cerveza Club Colombia', ''), 'Búsqueda vacía muestra todo');
assert.ok(matchesSearch('Cerveza Club Colombia', '  club   '), 'Espacios de más');
assert.ok(!matchesSearch('Cerveza Club Colombia', 'club light'), 'Todas las palabras deben aparecer');
assert.ok(matchesSearch('Mojito Clásico Cocteles', 'coctel'), 'Busca también en la categoría');
assert.deepStrictEqual([...catalogCategories()], ['Cervezas', 'Comidas', 'Licores', 'Sin categoría'], 'Ordenadas, sin «Todos» y con «Sin categoría»');
console.log('   ✅ buscador y categorías\n\n=== BUSCADOR DE PRODUCTOS E INVENTARIO: OK ===');
