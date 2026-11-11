// SPDX-License-Identifier: GPL-3.0-only
'use strict';
// Test-only prepared policy: synthetic home, no real nodes, no network or deployment.
const Module = require('node:module');
const {render} = require('./prepare');
function create(overrides = {}) {
  const prepared = new Module(__filename + '.candidate');
  prepared._compile(render({settings: {...require('./settings.example.json'), ...overrides}, home: '/__test_home__', pins: []}), __filename + '.candidate');
  return prepared.exports;
}
module.exports = create();
module.exports.create = create;
