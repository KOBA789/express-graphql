'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = graphqlHTTP;

var _accepts = require('accepts');

var _accepts2 = _interopRequireDefault(_accepts);

var _graphql = require('graphql');

var _httpErrors = require('http-errors');

var _httpErrors2 = _interopRequireDefault(_httpErrors);

var _url = require('url');

var _url2 = _interopRequireDefault(_url);

var _parseBody = require('./parseBody');

var _renderGraphiQL = require('./renderGraphiQL');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Middleware for express; takes an options object or function as input to
 * configure behavior, and returns an express middleware.
 */


/**
 * Used to configure the graphQLHTTP middleware by providing a schema
 * and other configuration options.
 *
 * Options can be provided as an Object, a Promise for an Object, or a Function
 * that returns an Object or a Promise for an Object.
 */

/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

function graphqlHTTP(options) {
  if (!options) {
    throw new Error('GraphQL middleware requires options.');
  }

  return (request, response) => {
    // Higher scoped variables are referred to at various stages in the
    // asyncronous state machine below.
    let schema;
    let context;
    let rootValue;
    let pretty;
    let graphiql;
    let formatErrorFn;
    let showGraphiQL;
    let query;
    let variables;
    let operationName;
    let validationRules;

    // Promises are used as a mechanism for capturing any thrown errors during
    // the asyncronous process below.

    // Resolve the Options to get OptionsData.
    new Promise(resolve => {
      resolve(typeof options === 'function' ? options(request, response) : options);
    }).then(optionsData => {
      // Assert that optionsData is in fact an Object.
      if (!optionsData || typeof optionsData !== 'object') {
        throw new Error('GraphQL middleware option function must return an options object ' + 'or a promise which will be resolved to an options object.');
      }

      // Assert that schema is required.
      if (!optionsData.schema) {
        throw new Error('GraphQL middleware options must contain a schema.');
      }

      // Collect information from the options data object.
      schema = optionsData.schema;
      context = optionsData.context;
      rootValue = optionsData.rootValue;
      pretty = optionsData.pretty;
      graphiql = optionsData.graphiql;
      formatErrorFn = optionsData.formatError;

      validationRules = _graphql.specifiedRules;
      if (optionsData.validationRules) {
        validationRules = validationRules.concat(optionsData.validationRules);
      }

      // GraphQL HTTP only supports GET and POST methods.
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        throw (0, _httpErrors2.default)(405, 'GraphQL only supports GET and POST requests.');
      }

      // Parse the Request body.
      return (0, _parseBody.parseBody)(request);
    }).then(bodyData => {
      const urlData = request.url && _url2.default.parse(request.url, true).query || {};
      showGraphiQL = graphiql && canDisplayGraphiQL(request, urlData, bodyData);

      // Get GraphQL params from the request and POST body data.
      const params = getGraphQLParams(urlData, bodyData);
      query = params.query;
      variables = params.variables;
      operationName = params.operationName;

      // If there is no query, but GraphiQL will be displayed, do not produce
      // a result, otherwise return a 400: Bad Request.
      if (!query) {
        if (showGraphiQL) {
          return null;
        }
        throw (0, _httpErrors2.default)(400, 'Must provide query string.');
      }

      // GraphQL source.
      const source = new _graphql.Source(query, 'GraphQL request');

      // Parse source to AST, reporting any syntax error.
      let documentAST;
      try {
        documentAST = (0, _graphql.parse)(source);
      } catch (syntaxError) {
        // Return 400: Bad Request if any syntax errors errors exist.
        response.statusCode = 400;
        return { errors: [syntaxError] };
      }

      // Validate AST, reporting any errors.
      const validationErrors = (0, _graphql.validate)(schema, documentAST, validationRules);
      if (validationErrors.length > 0) {
        // Return 400: Bad Request if any validation errors exist.
        response.statusCode = 400;
        return { errors: validationErrors };
      }

      // Only query operations are allowed on GET requests.
      if (request.method === 'GET') {
        // Determine if this GET request will perform a non-query.
        const operationAST = (0, _graphql.getOperationAST)(documentAST, operationName);
        if (operationAST && operationAST.operation !== 'query') {
          // If GraphiQL can be shown, do not perform this query, but
          // provide it to GraphiQL so that the requester may perform it
          // themselves if desired.
          if (showGraphiQL) {
            return null;
          }

          // Otherwise, report a 405: Method Not Allowed error.
          response.setHeader('Allow', 'POST');
          throw (0, _httpErrors2.default)(405, `Can only perform a ${ operationAST.operation } operation ` + 'from a POST request.');
        }
      }
      // Perform the execution, reporting any errors creating the context.
      try {
        return (0, _graphql.execute)(schema, documentAST, rootValue, context, variables, operationName);
      } catch (contextError) {
        // Return 400: Bad Request if any execution context errors exist.
        response.statusCode = 400;
        return { errors: [contextError] };
      }
    }).catch(error => {
      // If an error was caught, report the httpError status, or 500.
      response.statusCode = error.status || 500;
      return { errors: [error] };
    }).then(result => {
      // Format any encountered errors.
      if (result && result.errors) {
        result.errors = result.errors.map(formatErrorFn || _graphql.formatError);
      }
      // If allowed to show GraphiQL, present it instead of JSON.
      if (showGraphiQL) {
        const data = (0, _renderGraphiQL.renderGraphiQL)({
          query, variables,
          operationName, result
        });
        response.setHeader('Content-Type', 'text/html');
        response.write(data);
        response.end();
      } else {
        // Otherwise, present JSON directly.
        const data = JSON.stringify(result, null, pretty ? 2 : 0);
        response.setHeader('Content-Type', 'application/json');
        response.write(data);
        response.end();
      }
    });
  };
}

/**
 * Helper function to get the GraphQL params from the request.
 */
function getGraphQLParams(urlData, bodyData) {
  // GraphQL Query string.
  const query = urlData.query || bodyData.query;

  // Parse the variables if needed.
  let variables = urlData.variables || bodyData.variables;
  if (variables && typeof variables === 'string') {
    try {
      variables = JSON.parse(variables);
    } catch (error) {
      throw (0, _httpErrors2.default)(400, 'Variables are invalid JSON.');
    }
  }

  // Name of GraphQL operation to execute.
  const operationName = urlData.operationName || bodyData.operationName;

  return { query, variables, operationName };
}

/**
 * Helper function to determine if GraphiQL can be displayed.
 */
function canDisplayGraphiQL(request, urlData, bodyData) {
  // If `raw` exists, GraphiQL mode is not enabled.
  const raw = urlData.raw !== undefined || bodyData.raw !== undefined;
  // Allowed to show GraphiQL if not requested as raw and this request
  // prefers HTML over JSON.
  return !raw && (0, _accepts2.default)(request).types(['json', 'html']) === 'html';
}