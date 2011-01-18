'use strict'

exports['test get / put / post / del on atoms'] = require('./atoms');

if (module == require.main) require('test').run(exports)
