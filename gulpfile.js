var gulp = require('gulp');
var browserify = require('gulp-browserify');

gulp.task('scripts', function() {
    gulp.src('src/index.js')
        .pipe(browserify({
          insertGlobals : true
        }))
        .pipe(gulp.dest('./'));
});

gulp.task('watch', function() {
  gulp.watch('src/index.js', ['scripts']);
});

gulp.task('default', ['scripts', 'watch']);