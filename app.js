var express = require('express');
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var xmlParser = require('xml2js').parseString;
var http = require('http');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

var currencyMap = {};
var currencyTime;
var cacheTime = 0;
var maxCacheTime = process.env.EXPIRY || (1000 * 60 * 60 * 6) // 6 hours in milli-seconds
console.log("Cache expiry: " + maxCacheTime/1000 + " seconds")

//The url we want is: 'www.random.org/integers/?num=1&min=1&max=10&col=1&base=10&format=plain&rnd=new'
var ecbOptions = {
      host: 'www.ecb.europa.eu',
      port: '80',
      path: '/stats/eurofxref/eurofxref-daily.xml'
};

function updateRates() {

    http.request(ecbOptions, function(response) {
        var str = '';

        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function(chunk) {
            str += chunk;
        });

        //the whole response has been recieved, so we just print it out here
        response.on('end', function() {
            xmlParser(str, function(err, jsonRates) {
                currencyTime = jsonRates["gesmes:Envelope"].Cube[0].Cube[0]["$"].time;
                rates = jsonRates["gesmes:Envelope"].Cube[0].Cube[0].Cube;
                for (var idx in rates) {
                    var eachRate = rates[idx]["$"]
                    currencyMap[eachRate.currency] = eachRate.rate;
                }
                currencyMap["EUR"] = 1;
                console.log("Rates refreshed, currency map is: " + JSON.stringify(currencyMap));

            });

        });
    }).end();
    cacheTime = new Date().getTime();
}

function updateRateIfExpired() {
    var now = new Date().getTime();
    if (now - cacheTime > maxCacheTime) {
        updateRates();
        // rates update is async and updates can only be seen on the next request.
    }
}

updateRates(); // Get the latest rates and cache them on startup. IMPORTANT!!!

function promptInvalidCurrency(res) {
    res.writeHead(400, {
        "Content-Type": "text/plain"
    });
    res.write("Currency rate invalid, please check the currency code is supported");
    res.end();
}

app.get('/convert', function(req, res) {
    var baseCur = req.query.base
    var toCur = req.query.to
    // todo: validate input properly.
    if (toCur.length == 0 || baseCur.length == 0) {
        promptInvalidCurrency(res);
        return;
    }

    var toCurList = toCur.split(",");
    if (toCurList.length == 0) {
        toCurList[0] = toCur;
    }

    updateRateIfExpired();

    var convertedRates = {};
    for (idx in toCurList) {
        convertedRates[toCurList[idx]] = currencyMap[baseCur] / currencyMap[toCurList[idx]];
        if (isNaN(convertedRates[toCurList[idx]])) {
            promptInvalidCurrency(res);
            return;
        }
    }
    var data = {};
    data['date'] = currencyTime
    data['base'] = baseCur
    data['rates'] = {}
    for (eachCur in convertedRates) {
        data['rates'][eachCur] = convertedRates[toCurList[idx]]
    }
    res.write(JSON.stringify(data));
    res.end();
});

app.get('/list', function(req, res) {
    updateRateIfExpired();
    var data = {};
    data['supportedCurrencies'] = []
    for (var eachCurrency in currencyMap) {
        data['supportedCurrencies'].push(eachCurrency)
    }
    res.write(JSON.stringify(data));
    res.end();
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  promptInvalidCurrency(res)
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

module.exports = app;
