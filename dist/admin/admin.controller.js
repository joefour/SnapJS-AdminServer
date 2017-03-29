'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.setUtils = setUtils;
exports.getSchema = getSchema;
exports.index = index;
exports.show = show;
exports.create = create;
exports.update = update;
exports.destroy = destroy;
exports.destroyMultiple = destroyMultiple;
exports.importFromCsv = importFromCsv;

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _moment = require('moment');

var _moment2 = _interopRequireDefault(_moment);

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _mongoose = require('mongoose');

var _mongoose2 = _interopRequireDefault(_mongoose);

var _snapmobileAws = require('snapmobile-aws');

var _adminHelper = require('./admin.helper.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var utils = void 0;

function setUtils(_utils) {
  utils = _utils;
}

var blacklistRequestAttributes = ['_id', 'salt', 'resetPasswordExpires', 'resetPasswordToken', 'updatedAt', 'createdAt', '__v'];
var blacklistResponseAttributes = ['_id', 'password', 'salt', 'resetPasswordExpires', 'resetPasswordToken', '__v'];

/**
 * Return the mongoose schema for the class
 */
function getSchema(req, res, next) {
  res.status(200).json(req.class.schema.paths);
}

/**
 * Gets a list of documents based on a search query
 * If no search query is sent, it will return all documents
 * If export=true is found in the request query, we will output CSV instead of JSON
 */
function index(req, res, next) {
  var limit = Number(req.query.limit) || 20;
  var skip = Number(req.query.skip) || 0;
  var sort = req.query.sort || '-createdAt';

  // If export is sent as true in our query, we'll output a CSV instead of JSON
  var shouldExport = !!req.query.export;

  var searchFilters = req.query.filters || [];
  var searchQuery = {};

  // See if we have a populate method for our class
  // if we don't populatedFields should be blank
  var populatedFields = '';

  // Don't populate the fields if we are exporting
  if (typeof req.class.populateForAdmin === 'function' && !shouldExport) {
    populatedFields = req.class.populateForAdmin();
  }

  // We need to find any relationships that come through.
  // They will look like "_user.firstName" and we try and split fields in our filter.
  // Any that aren't relationships, we add to a separate array to run our .buildQuery()
  // on them as usual. Add any relationship filters to our relationshipPromises array to run together.
  var relationshipPromises = [];
  var queryOptions = [];
  var nonRelationshipFilters = [];

  // Find any relationship filters and typical / non-relationship filters
  for (var i = searchFilters.length - 1; i >= 0; i--) {

    // Check to see if there is a period in the filter field to denote a relationship
    var split = searchFilters[i].field.split('.');

    if (split.length > 1) {
      var searchClass = split[0];
      var searchField = split[1];
      queryOptions.push(split);

      var relationshipClassName = req.class.schema.paths[searchClass].options.ref;
      var relationshipClass = _mongoose2.default.model(relationshipClassName);

      // Build our relationship query and add to our relationshipPromises array to be run together
      var relationshipQuery = {};
      relationshipQuery[searchField] = {};

      // Convert and build with each operator string
      if (searchFilters[i].operator === 'like') {
        relationshipQuery[searchField]['$regex'] = new RegExp(searchFilters[i].value, 'i');
      } else if (searchFilters[i].operator === 'not equal') {
        relationshipQuery[searchField]['$ne'] = searchFilters[i].value;
      } else {
        relationshipQuery[searchField]['$eq'] = searchFilters[i].value;
      }

      relationshipPromises.push(relationshipClass.find(relationshipQuery, '_id'));
    } else {
      nonRelationshipFilters.push(searchFilters[i]);
    }
  }

  // Run all of our relationship promises together and wait for them all to complete
  return _bluebird2.default.all(relationshipPromises).then(function (results) {

    // Start our $and array to be able to push filters on
    searchQuery['$and'] = [];

    // Loop through the results to collect the IDs for each relationship
    for (var _i = results.length - 1; _i >= 0; _i--) {
      var resultIds = results[_i].map(function (o) {
        return o._id.toString();
      });
      var tmpQuery = {};
      tmpQuery[queryOptions[_i][0]] = { $in: resultIds };
      searchQuery['$and'].push(tmpQuery);
    }

    // Run the buildQuery function on any typical filters that come through
    // and concat it to any relationship filters we already found.
    var buildQuery = utils.buildQuery(nonRelationshipFilters);
    searchQuery['$and'] = searchQuery['$and'].concat(buildQuery['$and']);

    // $and could be blank, which causes an error
    searchQuery = !searchQuery['$and'].length ? {} : searchQuery;

    // Our query should now include any typical filters along with any $in queries
    return req.class.find(searchQuery).count().then(function (count) {

      return req.class.find(searchQuery).lean().populate(populatedFields).sort(sort).limit(limit).skip(skip).then(function (results) {

        // Perform any special admin functions on each document
        if (typeof req.class.populateForAdminFunctions === 'function') {
          var adminFunctions = req.class.populateForAdminFunctions();
          var promiseArray = [];
          var adminFunctionKeys = [];

          _lodash2.default.forOwn(adminFunctions, function (value, key) {
            // Loop through all results to build promise array
            results.map(function (o) {
              promiseArray.push(value(o[key]));
            });

            // Add key to array for tracking
            adminFunctionKeys.push(key);
          });

          return _bluebird2.default.each(promiseArray, function (o, i) {
            // Get the index based on how many results have passed
            var revolutions = Math.floor(i / results.length);

            // Get the index of the original array based on revolutions
            var index = results.length - ((revolutions + 1) * results.length - i);

            // Replace the string at the index with the object
            results[index][adminFunctionKeys[revolutions]] = o;
          }).then(function () {
            if (shouldExport) {
              var currentDate = (0, _moment2.default)().format('YYYY-MM-D');
              var filename = req.class.modelName + '-export-' + currentDate + '-.csv';
              var headers = Object.keys(req.class.schema.paths);
              var convertedString = (0, _adminHelper.convertToCsv)(results, headers);
              res.set('Content-Type', 'text/csv');
              res.set('Content-Disposition', 'attachment; filename=' + filename);
              res.send(convertedString);
              return null;
            } else {
              return { itemCount: count, items: results };
            }
          });
        } else {
          if (shouldExport) {
            var currentDate = (0, _moment2.default)().format('YYYY-MM-D');
            var filename = req.class.modelName + '-export-' + currentDate + '-.csv';
            var headers = Object.keys(req.class.schema.paths);
            var convertedString = (0, _adminHelper.convertToCsv)(results, headers);
            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', 'attachment; filename=' + filename);
            res.send(convertedString);
            return null;
          } else {
            return { itemCount: count, items: results };
          }
        }
      });
    });
  }).then(utils.respondWithResult(res, blacklistResponseAttributes)).catch(utils.handleError(next));
}

/**
 * Gets a single document from the DB
 */
function show(req, res, next) {
  // See if we have a populate method for our class
  // if we don't populatedFields should be blank
  var populatedFields = '';

  if (typeof req.class.populateForAdmin === 'function') {
    populatedFields = req.class.populateForAdmin();
  }

  req.class.findOne({ _id: req.params.id }).lean().populate(populatedFields).then(utils.handleEntityNotFound(res)).then(function (result) {

    // Perform any special admin functions on the document
    if (typeof req.class.populateForAdminFunctions === 'function') {
      var adminFunctions = req.class.populateForAdminFunctions();
      var promiseArray = [];
      var adminFunctionKeys = [];

      _lodash2.default.forOwn(adminFunctions, function (value, key) {
        promiseArray.push(value(result[key]));
        adminFunctionKeys.push(key);
      });

      return _bluebird2.default.each(promiseArray, function (o, i) {
        result[adminFunctionKeys[i]] = o;
      }).then(function () {
        return result;
      });
    } else {
      return result;
    }
  }).then(utils.respondWithResult(res, blacklistResponseAttributes)).catch(utils.handleError(next));
}

/**
 * Creates a new document in the DB
 */
function create(req, res, next) {
  req.class.create(req.body).then(function (result) {
    return result;
  }).then(utils.respondWithResult(res, blacklistResponseAttributes)).catch(utils.handleError(next));
}

/**
 * Updates an existing document in the DB
 */
function update(req, res, next) {
  req.class.findOne({ _id: req.params.id }).then(utils.handleEntityNotFound(res)).then(utils.cleanRequest(req, blacklistRequestAttributes)).then(function (result) {
    if (req.body._id) {
      delete req.body._id;
    }

    var updated = _lodash2.default.assign(result, req.body);
    return updated.save();
  }).then(utils.respondWithResult(res, blacklistResponseAttributes)).catch(utils.handleError(next));
}

/**
 * Deletes a document from the DB
 */
function destroy(req, res, next) {
  req.class.findById(req.params.id).then(utils.handleEntityNotFound(res)).then(function (result) {
    if (result) {
      return result.remove(function () {
        res.status(204).end();
      });
    }
  }).catch(utils.handleError(next));
}

/**
 * Deletes multiple documents from the DB
 */
function destroyMultiple(req, res, next) {
  req.class.find({ _id: { $in: req.body.ids } }).then(function (results) {
    if (results) {
      var promiseArray = results.map(function (result) {
        return result.remove();
      });

      return _bluebird2.default.each(promiseArray, function (result) {
        res.status(204).end();
      });
    }
  }).catch(utils.handleError(next));
}

/**
 * Imports objects from a csv file hosted at req.body.url
 */
function importFromCsv(req, res, next) {
  var url = req.body.url;
  var response = _snapmobileAws.awsHelper.getFile(url);
  response.then(function (response) {
    //remove empty lines at start and end
    var responseString = response.Body.toString('utf8').replace(/^\s+|\s+$/g, '');

    var schemaHeaders = Object.keys(req.class.schema.paths);
    var responseArray = (0, _adminHelper.csvToArray)(responseString);
    var csvHeaders = responseArray[0];
    var erroredRows = {};
    var finishedRows = 0;

    // Make sure headers exist in schema first before continuing
    for (var i = csvHeaders.length - 1; i >= 0; i--) {
      if (schemaHeaders.indexOf(csvHeaders[i]) < 0) {
        res.status(503).end(JSON.stringify({
          errors: {
            error: {
              message: 'The header "' + csvHeaders[i] + '" does not match any properties in the schema'
            }
          }
        }));
      }
    }

    for (var _i2 = 1; _i2 < responseArray.length; _i2++) {
      var object = {};
      for (var j = 0; j < csvHeaders.length; j++) {
        if (csvHeaders[j] != '_id' && blacklistRequestAttributes.indexOf(csvHeaders[j]) >= 0) {
          continue;
        }

        var element = responseArray[_i2][j];

        // If the element is undefined or null, convert to empty string
        if (!element) {
          element = '';
        }

        // If this element isn't a string, then we should try and parse it as JSON
        if (typeof element !== 'string') {
          element = JSON.parse(element);
        } else {
          // Since this is a CSV export, the array will be a string
          // We can determine if it is an array by checking for []
          if (element.substr(0, 1) === '[' && element.substr(-1, 1) === ']' || element.substr(0, 1) === '{' && element.substr(-1, 1) === '}') {
            try {
              element = JSON.parse(element);
            } catch (err) {
              res.status(503).end(JSON.stringify({ errors: { error: { message: 'Error parsing array' }
                }
              }));
            }
          }
        }

        object[csvHeaders[j]] = element;
      }

      createWithRow(req, object, _i2, function (result, row) {
        finishedRows++;
        returnIfFinished(res, finishedRows, responseArray, erroredRows);
      }, function (error, row) {
        finishedRows++;
        erroredRows[row] = error;
        returnIfFinished(res, finishedRows, responseArray, erroredRows);
      });
    }
  }, function (error) {
    res.status(400).end(JSON.stringify({ errors: { error: { message: 'An unknown error occured. Please try again.' }
      }
    }));
  });
}

/**
 * Creates an object and returns the passed row
 * @param {Object} req the req parameter
 * @param  {Object} object          the object number
 * @param  {Int} row             the row number
 * @param  {func} successCallback on success
 * @param  {func} errorCallback   on error
 */
function createWithRow(req, object, row, successCallback, errorCallback) {
  req.class.findById(object._id, function (err, found) {
    if (found) {
      req.class.findByIdAndUpdate(object._id, object).then(function (result) {
        successCallback(result, row);
      }).catch(function (error) {
        errorCallback(error, row);
      });
    } else {
      delete object._id;
      req.class.create(object).then(function (result) {
        successCallback(result, row);
      }).catch(function (error) {
        errorCallback(error, row);
      });
    }
  });
};

/**
 * Ends the current request if all imports have finished
 * @param  {Object} res the res parameter
 * @param  {Integer} finishedRows the number of finished rows
 * @param  {Array} responseArray  the CSV array
 * @param  {Object} erroredRows   the rows that have errored
 */
function returnIfFinished(res, finishedRows, responseArray, erroredRows) {
  if (finishedRows == responseArray.length - 1) {
    var numErrors = Object.keys(erroredRows).length;
    if (numErrors == 0) {
      res.status(204).end();
    } else {
      var errors = {};
      var numErrorsToDisplay = 5;
      var numExtraErrors = numErrors - numErrorsToDisplay;
      for (var key in erroredRows) {
        if (numErrorsToDisplay == 0) {
          continue;
        }

        numErrorsToDisplay--;
        errors['error' + key] = { message: 'Unable to add row: ' + key + ' with error: ' + erroredRows[key] };
      }

      if (numExtraErrors > 0) {
        errors.excess = { message: 'And ' + numExtraErrors + ' more errors' };
      }

      res.status(400).end(JSON.stringify({ errors: errors }));
    }
  }
}