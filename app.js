// Filename: app.js
var PAY_FROM_TOKEN = '';
var CLIENT_ID = '';
var CLIENT_SECRET = '';
var PAY_FROM_USER_ID = '';
var MONGODB_ADDRESS = 'mongodb://127.0.0.1:27017/test';

var PORT = 80;
var NEXT_CHECK_INTERVAL = 24*60*60; // time in seconds between Venmo checks (default 1 day)
var DB_CHECK_INTERVAL = 60; // how often in seconds to check db for users to check Venmo.

var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var url = require('url');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var MongoStore = require('connect-mongo')(session);
var request = require('request');

mongoose.connect(MONGODB_ADDRESS);

app.use(bodyParser.json());
app.listen(PORT);
app.use(cookieParser());
app.use(session({
  store: new MongoStore({ mongooseConnection: mongoose.connection }),
  secret: '1234567890QWERTY'
}))

var UserModel = mongoose.model('Users', {
  userid: String,
  balance: String,
  accessToken: String,
  tokenExpires: Number,
  refreshToken: String,
  nextCheck: Number,
  threshold: String
});

function ignoreCharge(paymentId, callback) {
  request({
    url: 'https://api.venmo.com/v1/payments/'+paymentId,
    qs: {
      access_token: PAY_FROM_TOKEN,
      action: 'deny'
    },
    method: 'PUT',
  },
  function(err, response, body) {
    if(err || response.statusCode != 200) {
      console.log(err);
    } else {
      console.log('payment ignored');
      if(callback) 
        callback();
    }
  });
}

function approveCharge(paymentId, callback) {
  request({
    url: 'https://api.venmo.com/v1/payments/'+paymentId,
    qs: {
      access_token: PAY_FROM_TOKEN,
      action: 'approve'
    },
    method: 'PUT',
  },
  function(err, response, body) {
    if(err || response.statusCode != 200) {
      console.log(err);
    } else {
      console.log('payment approved');
      if(callback) 
        callback();
    }
   });
}

function pay(from_token, to, amount, reason, callback) {
  request({
    url: 'https://api.venmo.com/v1/payments?access_token='+from_token,
    qs: {
      user_id: to,
      note: reason,
      amount: amount,
      audience: 'private'
    },
    method: 'POST',
  },
  function(err, response, body) {
      if(err || response.statusCode != 200) {
        console.log(err);
      } else {            
        console.log('payment made');
        if(callback) 
          callback();
      }
  });
}

// To setup Venmo app, use <url>/api/venmo as the webhook verification URL.
app.get('/api/venmo', function(req, res) {
  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;

  res.status(200);
  res.setHeader("Content-Type", "text/plain");
  res.send(query.venmo_challenge);
});

// Listens for the charge and pay events.
app.post('/api/venmo', function(req, res) {
  UserModel.findOne({userid: req.body.data.actor.id}, function(err, user) {
    if(req.body.type == 'payment.created' && req.body.data.action == 'charge') {
      if(!err) {
        var newBalance = parseFloat(user.balance) - parseFloat(req.body.data.amount);

        if(newBalance < 0) {
          // Exceeds the balance available. Ignore the request.
          ignoreCharge(req.body.data.id);
          return;
        }

        UserModel.update({userid: user.userid}, {balance: newBalance}, function(err, numAffected) {
          if(err) {
            console.log(err);
          } else {
            approveCharge(req.body.data.id);
          }
        });
      }

      return;
    }

    if(req.body.type == 'payment.created' && req.body.data.action == 'pay' && req.body.data.status == 'settled') {
      if(err) {
        console.log(err);
        return;
      }

      var newBalance = parseFloat(user.balance) + parseFloat(req.body.data.amount);

      UserModel.update({userid: user.userid}, {balance: newBalance}, function(err, numAffected) {
        if(err) {
          console.log(err);
        } else {
          console.log('new balance: '+newBalance);
        }
      });      
    }
  });  
});

app.get('/api/user', function(req, res) {
  res.setHeader("Content-Type", "application/json");

  if(!req.session.userid) {
    res.status(401);
    res.send('{"error":"Not authenticated"}');
  } else {
    UserModel.findOne({userid: req.session.userid}, function(err, user) {
      if(err || !user) {
        res.status(401);
        res.send('{"error":"Not authenticated"}');
      } else {
        res.send(JSON.stringify({
          balance: parseFloat(user.balance).toFixed(2), 
          active: user.nextCheck !== 0, 
          threshold: user.threshold
        }));
      }
    });
  }
});

app.post('/api/active', function(req, res) {
  res.setHeader("Content-Type", "application/json");

  if(!req.session.userid) {
    res.status(401);
    res.send('{"error":"Not authenticated"}');
  } else {
    var timeNow = new Date();
    nextCheck = req.body.active ? timeNow.getTime() : 0;

    UserModel.update({userid: req.session.userid}, {nextCheck: nextCheck}, function(err, numAffected) {
      if(err) {
        res.status(401);
        res.send('{"error":"Not authenticated"}');
      } else {
        res.send(JSON.stringify({active: nextCheck > 0}));
      }
    });
  }  
});

app.post('/api/threshold', function(req, res) {
  res.setHeader("Content-Type", "application/json");

  if(!req.session.userid) {
    res.status(401);
    res.send('{"error":"Not authenticated"}');
  } else {
    UserModel.update({userid: req.session.userid}, {threshold: req.body.threshold}, function(err, numAffected) {
      if(err) {
        res.status(401);
        res.send('{"error":"Not authenticated"}');
      } else {
        var response = {threshold: req.body.threshold};
        res.send(JSON.stringify(response));
      }
    });
  }  
});

app.get('/oauth', function(req, res) {
  res.redirect('https://api.venmo.com/v1/oauth/authorize?client_id='+CLIENT_ID+'&scope=make_payments%20access_profile%20access_balance&response_type=code');
});

app.get('/oauth_callback', function(req, res) {
  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;

  req.session.access_token = query.code;

  var qs = {
    client_id: CLIENT_ID,
    code: query.code,
    client_secret: CLIENT_SECRET
  }

  request({
      url: 'https://api.venmo.com/v1/oauth/access_token',
      qs: qs,
      method: 'POST',
    },
    function(err, response, body) {
      if(err || response.statusCode != 200) {
        console.log(err);
        res.send('Unable to authenticate with Venmo.');
        return;
      } else {
        var js = JSON.parse(body);

        UserModel.findOne({userid: js.user.id}, function(err, user) {
          if(!user) {
            var timeNow = new Date();

            UserModel.create({
                userid: js.user.id,
                balance: '0.00',
                accessToken: js.access_token,
                tokenExpires: timeNow.getTime()+js.expires_in,
                refreshToken: js.refresh_token,
                nextCheck: 0,
                threshold: '1.00'
              }, function(err, user) {
                console.log(user);

                req.session.userid = js.user.id;
                res.redirect('/');
            });
          } else {
            console.log(user);

            req.session.userid = js.user.id;
            res.redirect('/');
          }
        });
      }
  });
});

app.get('/logout', function(req, res) {
  req.session.destroy();
  res.redirect('/');
});

setInterval(function() {
  var timeNow = new Date();

  UserModel.find({nextCheck: {$lt: timeNow.getTime(), $gt: 0}}, function(err, users) {
    for(var i in users) {
      request({
        url: 'https://api.venmo.com/v1/me?access_token='+users[i].accessToken,
        method: 'GET',
      },
      function(error, response, body) {
        if(error || response.statusCode != 200) {
            return;
        } else {
          var js = JSON.parse(body);
          var threshold = users[i].threshold;
          var balance = parseFloat(js.data.balance);

          var contribution = balance%1.00;

          if((balance-contribution) < threshold || contribution == 0) {
            return;
          }

          var newBalance = (parseFloat(users[i].balance)+contribution).toFixed(2);

          pay(users[i].accessToken, PAY_FROM_USER_ID, contribution, 'Contributing $'+contribution.toFixed(2)+' for a total $'+newBalance);  

          UserModel.update({_id: users[i]._id}, {
            balance: newBalance, 
            nextCheck: users[i].nextCheck+(NEXT_CHECK_INTERVAL*1000)
          });
        }
      });      
    }
  });
}, DB_CHECK_INTERVAL*1000);

app.use(express.static(__dirname + '/public'));

console.log('App listening on port '+PORT);