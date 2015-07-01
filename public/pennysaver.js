// Filename: public/pennysaver.js

angular.module('pennySaverApp', [])
.controller('PennySaverCtrl', function($scope, $http) {
  $scope.balance = null;
  $scope.active = false;
  $scope.threshold = '';

  $http.get('/api/user').success(function(result) {
    $scope.balance = result.balance;
    $scope.active = result.active;
    $scope.threshold = result.threshold;
  }).catch(function(error) {
    console.log(error);
  });

  $scope.changeThreshold = function() {
    $http.post('/api/threshold', {threshold: $scope.threshold}).success(function(result) {
      $scope.threshold = result.threshold;
    }).catch(function(error) {
      console.log(error);
    });
  }

  $scope.stopService = function() {
    $http.post('/api/active', {active: false}).success(function(result) {
      $scope.active = result.active;
    }).catch(function(error) {
      console.log(error);
    });
  }

  $scope.startService = function() {
    $http.post('/api/active', {active: true}).success(function(result) {
      $scope.active = result.active;
    }).catch(function(error) {
      console.log(error);
    });
  }
});