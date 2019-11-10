'use strict';
 
const tabletojson = require('tabletojson');
const Json2csvParser = require('json2csv').Parser;
const fields = ['0','1','2','3'];
const opts = { fields };

tabletojson.convertUrl(
    'https://www.officialcharts.com/chart-news/all-the-number-1-singles__7931/',
    function(tablesAsJson) {

      for (var i = 0; i < tablesAsJson.length; i++) {
          if (i === 9) {
            try {
                const parser = new Json2csvParser(opts);
                const csv = parser.parse(tablesAsJson[i]);
                console.log(csv);
              } catch (err) {
                console.error(err);
              }
          }
      }
    }
);
