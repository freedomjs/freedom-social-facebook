// TODO: use social integration tests from https://github.com/freedomjs/freedom/tree/master/spec/providers/social

var freedomPrefix = require.resolve('freedom').substr(0,
        require.resolve('freedom').lastIndexOf('freedom') + 8);

module.exports = function(grunt) {
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    copy: {
      demo_chrome: {
        files: [{
          src: [
            'src/*',
            'demo_common/*',
            'demo_chrome/*',
            'node_modules/freedom-for-chrome/freedom-for-chrome.js'
          ],
          dest: 'build/demo_chrome/',
          flatten: true,
          filter: 'isFile',
          expand: true
        }, {
          src: [
            'demo_chrome/ui/*'
          ],
          dest: 'build/demo_chrome/ui',
          flatten: true,
          filter: 'isFile',
          expand: true
        }, {
          src: [
            'third_party/lib/polymer/*'
          ],
          dest: 'build/demo_chrome/polymer',
          flatten: true,
          filter: 'isFile',
          expand: true
        }]
      }
    },
    /* TODO(dborkan): add testing
    jasmine: {
      dns: {
        src: ['spec/dns_context.js', 'lib/dns.js'],
        options: {
          specs: 'spec/dns.unit.spec.js',
          keepRunner: false
        }
      }
    },
    jasmine_node: {
      integration: ['spec/integration/']
    },
    */
  });

  // Load tasks.
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-jasmine');
  grunt.loadNpmTasks('grunt-jasmine-node');

  // Default tasks.
  grunt.registerTask('chrome_demo', [
    'copy:demo_chrome'
  ]);
  /* TODO(dborkan): add tests
  grunt.registerTask('test', [
    'compile',
    'copy:jasmine',
    'jasmine:dns',
    'jasmine_node'
  ]);
  */
  // TODO(dborkan): add compile as default for npm packaging
  grunt.registerTask('default', ['chrome_demo']);
};