'use strict'

exports['test get / put / post on atoms'] = require('./atoms');

if (module == require.main) require('test').run(exports)
