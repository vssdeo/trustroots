/**
 * Push service
 */
(function () {
  'use strict';

  describe('Push Service Tests', function () {

    var $httpBackend;

    var firebase = createFirebaseMock();

    // Load the main application module
    beforeEach(module(AppConfig.appModuleName, firebase.moduleName));

    beforeEach(firebase.reset);

    var notifications = [];

    beforeEach(inject(function(
      _$httpBackend_, $templateCache, $cookies, $window, Authentication) {

      $httpBackend = _$httpBackend_;
      $templateCache.put('/modules/pages/views/home.client.view.html', '');
      $templateCache.put('/modules/core/views/404.client.view.html', '');
      Authentication.user = {
        pushRegistration: []
      };
      $cookies.remove('tr.push');
      notifications.length = 0;
      $window.Notification = function(title, options) {
        notifications.push({ title: title, options: options });
      };
    }));

    afterEach(inject(function($cookies) {
      $cookies.remove('tr.push');
    }));

    afterEach(function() {
      $httpBackend.verifyNoOutstandingExpectation();
      $httpBackend.verifyNoOutstandingRequest();
    });

    it('will save to server if enabled', inject(function(
      push, Authentication, $cookies) {
      if (!push.isSupported) return;

      var token = 'mynicetoken';
      firebase.token = token;

      $httpBackend.expect('POST', '/api/users/push/registrations',
        { token: token, platform: 'web' })
        .respond(200, {
          user: {
            pushRegistration: [{ token: token, platform: 'web', created: Date.now() }]
          }
        });

      push.enable();

      $httpBackend.flush();
      expect(firebase.requestPermissionCalled).toBe(1);
      expect(firebase.permissionGranted).toBe(true);
      expect(Authentication.user.pushRegistration.length).toBe(1);
      expect(Authentication.user.pushRegistration[0].token).toBe(token);
      expect($cookies.get('tr.push')).toBe('on');
    }));

    it('will save to server during initialization if on but not present', inject(function(
      push, firebaseMessaging, $cookies, Authentication) {
      if (!push.isSupported) return;

      var token = 'mynicetokenforinitializing';

      $httpBackend.expect('POST', '/api/users/push/registrations',
        { token: token, platform: 'web' })
        .respond(200, {
          user: {
            pushRegistration: [{
              token: token,
              platform: 'web',
              created: Date.now()
            }]
          }
        });

      // if we turn it on...
      $cookies.put('tr.push', 'on');
      firebase.permissionGranted = true;
      firebase.token = token;

      // .. and enable it to be initialized
      firebaseMessaging.shouldInitialize = true;

      // we will cause it to register on the server
      push.init();

      expect(Authentication.user.pushRegistration.length).toBe(0);

      $httpBackend.flush();

      expect(Authentication.user.pushRegistration.length).toBe(1);
      expect(Authentication.user.pushRegistration[0].token).toBe(token);
    }));

    it('can be disabled and will be removed from server', inject(function(
      push, Authentication, $cookies, $rootScope) {
      if (!push.isSupported) return;

      var token = 'sometokenfordisabling';

      // Preregister it
      firebase.token = token;
      firebase.permissionGranted = true;
      Authentication.user.pushRegistration.push({
        token: token, platform: 'web'
      });

      expect(push.isEnabled).toBe(false);

      // first enable it ...

      push.enable();
      $rootScope.$apply();

      expect(firebase.requestPermissionCalled).toBe(0);
      expect(Authentication.user.pushRegistration.length).toBe(1);
      expect($cookies.get('tr.push')).toBe('on');
      expect(push.isEnabled).toBe(true);

      // ... now disable it again

      $httpBackend.expect('DELETE', '/api/users/push/registrations/' + token)
        .respond(200, {
          user: {
            pushRegistration: []
          }
        });

      push.disable();
      $httpBackend.flush();

      expect(Authentication.user.pushRegistration.length).toBe(0);
      expect($cookies.get('tr.push')).toBeFalsy();
      expect(firebase.deletedTokens.length).toBe(1);
      expect(firebase.deletedTokens[0]).toBe(token);
      expect(push.isEnabled).toBe(false);

    }));

    it('will not save to server if enabling and already registered', inject(function(
      push, Authentication, $rootScope, $cookies) {
      if (!push.isSupported) return;

      var token = 'sometoken';
      // Preregister it
      firebase.token = token;
      firebase.permissionGranted = true;
      Authentication.user.pushRegistration.push({
        token: token, platform: 'web'
      });
      push.enable();
      $rootScope.$apply();
      expect(firebase.requestPermissionCalled).toBe(0);
      expect(push.isEnabled).toBe(true);
      expect($cookies.get('tr.push')).toBe('on');
    }));

    it('should trigger a notification when a message is received', inject(function(push) {
      if (!push.isSupported) return;
      firebase.triggerOnMessage({
        notification: {
          title: 'foo',
          body: 'yay'
        }
      });
      expect(notifications.length).toBe(1);
      expect(notifications[0].title).toBe('foo');
      expect(notifications[0].options.body).toBe('yay');
    }));

  });

  function createFirebaseMock() {

    var onMessageCallbacks = [];
    var onTokenRefreshCallbacks = [];

    var firebase = {
      deletedTokens: [],
      reset: reset,
      moduleName: 'firebaseMessagingMock',

      triggerOnMessage: function() {
        var args = arguments;
        onMessageCallbacks.forEach(function(fn) {
          fn.apply(null, args);
        });
      },

      triggerOnTokenRefresh: function() {
        var args = arguments;
        onTokenRefreshCallbacks.forEach(function(fn) {
          fn.apply(null, args);
        });
      }

    };

    function reset() {
      onMessageCallbacks.length = 0;
      onTokenRefreshCallbacks.length = 0;
      firebase.token = null;
      firebase.permissionGranted = false;
      firebase.deletedTokens.length = 0;
      firebase.requestPermissionCalled = 0;
      firebase.removeServiceWorkerCalled = 0;
    }

    angular.module(firebase.moduleName, [])

      // this will replace the real one
      .factory('firebaseMessaging', create);

    function create($q) {
      return {
        name: 'fcm-mock',
        shouldInitialize: false, // means core does not set it up for us
        getToken: function() {
          if (firebase.permissionGranted) {
            return $q.resolve(firebase.token);
          } else {
            return $q.resolve(null);
          }
        },
        requestPermission: function() {
          firebase.permissionGranted = true;
          firebase.requestPermissionCalled++;
          return $q.resolve();
        },
        deleteToken: function(token) {
          firebase.deletedTokens.push(token);
          return $q.resolve();
        },
        onTokenRefresh: function(fn) {
          onTokenRefreshCallbacks.push(fn);
        },
        onMessage: function(fn) {
          onMessageCallbacks.push(fn);
        },
        removeServiceWorker: function() {
          firebase.removeServiceWorkerCalled++;
        }
      };
    }

    return firebase;

  }

}());
