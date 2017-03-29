'use strict';

/**
 * Processes the result to be sent in the response
 * Removes any blacklisted attributes before sending the JSON object
 * @param  {Object} res                 The response object for the request
 * @param  {Array}  blacklistAttributes Array of blacklisted attributes as strings
 * @return {Function<Response>}         200 response with processed entity
 */
export function respondWithResult(res, blacklistAttributes = []) {
  return entity => {
    if (entity) {
      // Remove properties from objects before sending the response
      if (Object.prototype.toString.call(entity) !== '[object Array]') {
        // Prevent calling toObject on an object
        if (typeof entity.toObject === 'function') {
          entity = entity.toObject();
        }

        for (let i = blacklistAttributes.length - 1; i >= 0; i--) {
          if (blacklistAttributes[i] !== '_id') {
            delete entity[blacklistAttributes[i]];
          }
        }
      }

      res.status(200).json(entity);
      return null;
    }
  };
}

/**
 * Handle entity not found for a request / response
 * @param  {Object} res The response object for the request
 * @return {Function<Object>}     The entity that was found or ends request with 404
 */
export function handleEntityNotFound(res) {
  return entity => {
    if (!entity) {
      res.status(404).end();
      return;
    }

    return entity;
  };
}

/**
 * Removes blacklisted attributes from the request object
 * @param  {Object} req                 The request object
 * @param  {Array}  blacklistAttributes Array of blacklisted attributes as strings
 * @return {Object}                     The cleaned request
 */
export function cleanRequest(req, blacklistAttributes = []) {
  for (let i = blacklistAttributes.length - 1; i >= 0; i--) {
    if (req.body[blacklistAttributes[i]]) {
      delete req.body[blacklistAttributes[i]];
    }
  }
}

/**
 * Handles errors for a request
 * @param  {Function} next The next object from the request
 * @return {Function}      Function to handle errors
 */
export function handleError(next) {
  return err => next(err);
}

/**
 * Builds query based on given search filters
 * @param  {Array} searchFilters  Array of filter objects
 * @return {Object} database search query
 */
export function buildQuery(searchFilters) {
  let searchQuery = {};
  const OPERATOR_MAP = {
    equals: '$eq',
    'not equal': '$ne',
    'greater than': '$gt',
    'less than': '$lt',
    'greater than or equal to': '$gte',
    'less than or equal to': '$lte',
    like: '$regex',
  };

  searchQuery.$and = [];
  searchFilters.forEach(function(filter) {
    let innerQuery = {};
    let operator = {};

    // Fuzzy search
    if (filter.operator === 'like') {
      operator[OPERATOR_MAP[filter.operator]] = new RegExp(filter.value, 'i');
      innerQuery[filter.field] = operator;

    // Boolean search
    } else if (filter.field === 'active') {
      if (filter.operator === 'true') {
        innerQuery[filter.field] = true;
      } else {
        innerQuery[filter.field] = null;
      }

    // Date search
    } else if (filter.field == 'createdAt' || filter.field == 'updatedAt') {
      operator[OPERATOR_MAP[filter.operator]] = new Date(filter.value);
      innerQuery[filter.field] = operator;

    // Integer and string exact search
    } else {
      operator[OPERATOR_MAP[filter.operator]] = filter.value;
      innerQuery[filter.field] = operator;
    }

    searchQuery.$and.push(innerQuery);
  });

  return searchQuery;
}

/**
 * @param  {Array} result Array of objects - results from database query
 * @param  {Array} headers Schema properties
 * Converts data to CSV string
 */
export function convertToCsv(result, headers) {
  let columnDelimiter = ',';
  let lineDelimiter = '\n';
  let convertedString = '';
  let jsonString = '';

  convertedString += headers.join(columnDelimiter);
  convertedString += lineDelimiter;

  // Build CSV string by iterating over each object and each header adding the data to the converted string
  for (let i = 0; i < result.length; i++) {
    for (let x = 0; x < headers.length; x++) {

      if (x > 0) { convertedString += columnDelimiter; };

      // Undefined will show up in the CSV as 'undefined', we want ''
      if (result[i][headers[x]] === undefined || result[i][headers[x]] === null) {
        convertedString += '';

      // Objects will be added to the CSV as '[Object object]', we want the object
      } else if (!!result[i][headers[x]] &&
                (result[i][headers[x]].constructor === Array ||
                 result[i][headers[x]].constructor === Object)) {

        // Stringify any objects that are in the db

        jsonString = JSON.stringify(result[i][headers[x]]);
        convertedString += `"${String(jsonString).replace(/\"/g, '""')}"`;

      // Double quotes and hanging quotes will break our CSV, replace with "" will fix it
      } else {
        convertedString += `"${String(result[i][headers[x]]).replace(/\"/g, '""')}"`;
      }
    }

    convertedString += lineDelimiter;
  }

  return convertedString.replace(/'/g, '""').replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '""$2"": ');
}

/**
 * Helper function to convert a CSV to array
 * @param {String} strData The CSV String
 * @param {String} strDelimiter Optional delimiter
 */
export function csvToArray(strData, strDelimiter = ',') {
  // Create a regular expression to parse the CSV values.
  var objPattern = new RegExp(
      (

          // Delimiters.
          '(\\' + strDelimiter + '|\\r?\\n|\\r|^)' +

          // Quoted fields.
          '(?:"([^"]*(?:""[^"]*)*)"|' +

          // Standard fields.
          '([^"\\' + strDelimiter + '\\r\\n]*))'
      ),
      'gi'
      );

  // Create an array to hold our data. Give the array
  // a default empty first row.
  var arrData = [[]];

  // Create an array to hold our individual pattern
  // matching groups.
  var arrMatches = null;

  // Keep looping over the regular expression matches
  // until we can no longer find a match.
  while (arrMatches = objPattern.exec(strData)) {

    // Get the delimiter that was found.
    var strMatchedDelimiter = arrMatches[1];

    // Check to see if the given delimiter has a length
    // (is not the start of string) and if it matches
    // field delimiter. If id does not, then we know
    // that this delimiter is a row delimiter.
    if (
      strMatchedDelimiter.length &&
      (strMatchedDelimiter != strDelimiter)
      ) {

      // Since we have reached a new row of data,
      // add an empty row to our data array.

      arrData.push([]);
    }

    // Now that we have our delimiter out of the way,
    // let's check to see which kind of value we
    // captured (quoted or unquoted).
    if (arrMatches[2]) {
      // We found a quoted value. When we capture
      // this value, unescape any double quotes.
      var strMatchedValue = arrMatches[2].replace(
          new RegExp('""', 'g'),
          '"'
          );
    } else {
      // We found a non-quoted value.
      var strMatchedValue = arrMatches[3];
    }

    // Now that we have our value string, let's add
    // it to the data array.
    arrData[arrData.length - 1].push(strMatchedValue);
  }

  return arrData;
}