'use strict';

var Bluebird  = require('bluebird');
var expect    = require('expect.js');
var helper    = require('../helper');
var Umzug     = require('../../index');
var sinon     = require('sinon');

describe('execute', function () {
  beforeEach(function () {
    return helper
      .prepareMigrations(1, { names: ['123-migration'] })
      .bind(this)
      .then(function () {
        this.migration = require('../tmp/123-migration.js');
        this.upStub    = sinon.stub(this.migration, 'up', Bluebird.resolve);
        this.downStub  = sinon.stub(this.migration, 'down', Bluebird.resolve);
        this.logSpy    = sinon.spy();
        this.umzug     = new Umzug({
          migrations:     { path: __dirname + '/../tmp/' },
          storageOptions: { path: __dirname + '/../tmp/umzug.json' },
          logging:        this.logSpy
        });
        this.migrate = function (method) {
          return this.umzug.execute({
            migrations: ['123-migration'],
            method:     method
          });
        }.bind(this);
        ['migrating', 'migrated', 'reverting', 'reverted'].forEach(function(event) {
          var spy = this[event + 'EventSpy'] = sinon.spy();
          this.umzug.on(event, spy);
        }, this);
      });
  });

  afterEach(function () {
    this.migration.up.restore();
    this.migration.down.restore();
  });

  it('runs the up method of the migration', function () {
    return this
      .migrate('up').bind(this)
      .then(function () {
        expect(this.upStub.callCount).to.equal(1);
        expect(this.downStub.callCount).to.equal(0);
        expect(this.logSpy.callCount).to.equal(2);
        expect(this.logSpy.getCall(0).args[0]).to.equal('== 123-migration: migrating =======');
        expect(this.logSpy.getCall(1).args[0]).to.match(/== 123-migration: migrated \(0\.0\d\ds\)/);
        expect(this.migratingEventSpy.calledWith('123-migration')).to.equal(true);
        expect(this.migratedEventSpy.calledWith('123-migration')).to.equal(true);
      });
  });

  it('runs the down method of the migration', function () {
    return this
      .migrate('down').bind(this)
      .then(function () {
        expect(this.upStub.callCount).to.equal(0);
        expect(this.downStub.callCount).to.equal(1);
        expect(this.logSpy.callCount).to.equal(2);
        expect(this.logSpy.getCall(0).args[0]).to.equal('== 123-migration: reverting =======');
        expect(this.logSpy.getCall(1).args[0]).to.match(/== 123-migration: reverted \(0\.0\d\ds\)/);
        expect(this.revertingEventSpy.calledWith('123-migration')).to.equal(true);
        expect(this.revertedEventSpy.calledWith('123-migration')).to.equal(true);
      });
  });

  it('does not execute a migration twice', function () {
    return this.migrate('up').bind(this).then(function () {
      return this.migrate('up');
    }).then(function () {
      expect(this.upStub.callCount).to.equal(1);
      expect(this.downStub.callCount).to.equal(0);
    });
  });

  it('does not add an executed entry to the storage.json', function () {
    return this.migrate('up').bind(this).then(function () {
      return this.migrate('up');
    }).then(function () {
      var storage = require(this.umzug.options.storageOptions.path);
      expect(storage).to.eql(['123-migration.js']);
    });
  });

  it('calls the migration without params by default', function () {
    return this.migrate('up').bind(this).then(function () {
      expect(this.upStub.getCall(0).args).to.eql([]);
    });
  });

  it('calls the migration with the specified params', function () {
    this.umzug.options.migrations.params = [1, 2, 3];

    return this.migrate('up').bind(this).then(function () {
      expect(this.upStub.getCall(0).args).to.eql([1, 2, 3]);
    });
  });

  it('calls the migration with the result of the passed function', function () {
    this.umzug.options.migrations.params = function () {
      return [1, 2, 3];
    };

    return this.migrate('up').bind(this).then(function () {
      expect(this.upStub.getCall(0).args).to.eql([1, 2, 3]);
    });
  });

  describe('when the migration does not contain a migration method', function () {
    beforeEach(function () {
      this.oldup = this.migration.up;
      delete this.migration.up;
    });

    it('rejects the promise', function () {
      return this.migrate('up').bind(this).then(function () {
        return Bluebird.reject('We should not end up here...');
      }, function (err) {
        expect(err).to.equal('Could not find migration method: up');
      });
    });

    afterEach(function () {
      this.migration.up = this.oldup;
      delete this.oldup;
    });
  });
});

describe('migrations.wrap', function () {
  beforeEach(function () {
    helper.clearTmp();
    require('fs').writeFileSync(__dirname + '/../tmp/123-callback-last-migration.js', [
      '\'use strict\';',
      '',
      'module.exports = {',
      '  up: function (done) {',
      '    setTimeout(done, 200);',
      '  },',
      '  down: function () {}',
      '};'
      ].join('\n')
    );
  });

  it('can be used to handle "callback last" migrations', function () {
    var start = +new Date();
    var umzug = new Umzug({
      migrations: {
        path: __dirname + '/../tmp/',
        wrap: function (fun) {
          if (fun.length === 1) {
            return Bluebird.promisify(fun);
          } else {
            return fun;
          }
        }
      },
      storageOptions: { path: __dirname + '/../tmp/umzug.json' }
    });

    return umzug.execute({
      migrations: ['123-callback-last-migration'],
      method:     'up'
    }).then(function () {
      expect(+new Date() - start).to.be.greaterThan(200);
    });
  });
});

describe('coffee-script support', function () {
  beforeEach(function () {
    helper.clearTmp();
    require('fs').writeFileSync(__dirname + '/../tmp/123-coffee-migration.coffee', [
      '\'use strict\'',
      '',
      'module.exports =',
      '  up: () ->',
      '  down: () ->'
      ].join('\n')
    );
  });

  it('runs the migration', function () {
    var umzug = new Umzug({
      migrations: {
        path:    __dirname + '/../tmp/',
        pattern: /\.coffee$/
      },
      storageOptions: {
        path: __dirname + '/../tmp/umzug.json'
      }
    });

    return umzug.execute({
      migrations: ['123-coffee-migration'],
      method:     'up'
    });
  });
});

describe('upName / downName', function () {
  beforeEach(function () {
    helper.clearTmp();
    require('fs').writeFileSync(__dirname + '/../tmp/123-custom-up-down-names-migration.js', [
          '\'use strict\';',
          '',
          'module.exports = {',
          '  myUp: function () {},',
          '  myDown: function () {}',
          '};'
        ].join('\n')
    );
    this.migration = require('../tmp/123-custom-up-down-names-migration.js');
    this.upStub    = sinon.stub(this.migration, 'myUp', Bluebird.resolve);
    this.downStub  = sinon.stub(this.migration, 'myDown', Bluebird.resolve);
    this.umzug     = new Umzug({
      migrations:     { path: __dirname + '/../tmp/' },
      storageOptions: { path: __dirname + '/../tmp/umzug.json' },
      upName: 'myUp',
      downName: 'myDown'
    });
    this.migrate = function (method) {
      return this.umzug.execute({
        migrations: ['123-custom-up-down-names-migration'],
        method:     method
      });
    }.bind(this);
  });

  afterEach(function () {
    this.migration.myUp.restore();
    this.migration.myDown.restore();
  });

  it('runs the custom up method of the migration', function () {
    return this
      .migrate('up').bind(this)
      .then(function ()  {
        expect(this.upStub.callCount).to.equal(1);
        expect(this.downStub.callCount).to.equal(0);
      });
  });

  it('runs the custom down method of the migration', function () {
    return this
      .migrate('down').bind(this)
      .then(function ()  {
        expect(this.downStub.callCount).to.equal(1);
        expect(this.upStub.callCount).to.equal(0);
      });
  });
});
