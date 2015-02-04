var THREE = require('three-vr');
var _ = require('underscore');

createApp = function(recognition) {
  var trackPlaying;

  renderer = new THREE.WebGLRenderer({
    precision: "mediump",
    devicePixelRatio: 1.5,
    antialias: true
  });
  var element = renderer.domElement;

  renderer.setSize(window.innerWidth, window.innerHeight);
  var container = document.getElementById('app');
  container.appendChild(renderer.domElement);

  var effect = new THREE.StereoEffect(renderer);

  var scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(90, (window.innerWidth) / window.innerHeight, 0.001, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(new THREE.Vector3(0.0, 0.0, 0.0));
  scene.add(camera);

  var domEvents = new THREEx.DomEvents(camera, element);

  controls = new THREE.OrbitControls(camera, element);
  controls.rotateUp(Math.PI / 4);
  controls.target.set(
    camera.position.x + 0.1,
    camera.position.y,
    camera.position.z
    );
  controls.noZoom = false;
  controls.noPan = true;

  createDome();
  createControls();
  createNavigation();

  var ambientLight = new THREE.AmbientLight(0xbbbbbb);
  scene.add(ambientLight);

  var clock = new THREE.Clock();
  animate();

  function setOrientationControls(e) {
    if (!e.alpha) {
      return;
    }

    controls = new THREE.DeviceOrientationControls(camera, true);
    controls.connect();
    controls.update();

    element.addEventListener('click', fullscreen, false);

    window.removeEventListener('deviceorientation', setOrientationControls);
  }

  window.addEventListener('deviceorientation', setOrientationControls, true);
  window.addEventListener('resize', resize, false);
  setTimeout(resize, 1);


  function resize() {
    var width = container.offsetWidth;
    var height = container.offsetHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    effect.setSize(width, height);
  }

  function update(dt) {
    resize();
    camera.updateProjectionMatrix();
    controls.update(dt);
  }

  function render(dt) {
    effect.render(scene, camera);
  }

  function animate() {
    update(clock.getDelta());
    render(clock.getDelta());

    requestAnimationFrame(function() {
      animate();
    });
  }

  function createDome() {
    var obj = new THREE.Object3D();
    cubes = new Array();

    for (i = 0.0; i <= (Math.PI * 2); i += Math.PI / 6) {
      if (!tracksArray.length)
        return;

      var track = tracksArray.pop();
      var material;

      if (track.artwork_url)
        material = new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture(track.artwork_url)
        });
      else
        material = new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/soundcloud.png")
        });

      var cube = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), material);
      var play = new THREE.Mesh(new THREE.PlaneGeometry(50, 50),
        new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/play102.png"),
          transparent: true,
          opacity: 0
        }));

      var pause = new THREE.Mesh(new THREE.PlaneGeometry(50, 50),
        new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/pause31.png"),
          transparent: true,
          opacity: 0
        }));

      cube.overdraw = true;
      obj.add(pause);
      obj.add(play);
      obj.add(cube);

      cube.translateZ(200 * Math.sin(i));
      cube.translateX(200 * Math.cos(i));

      play.translateZ(190 * Math.sin(i));
      play.translateX(190 * Math.cos(i));

      pause.translateZ(190 * Math.sin(i));
      pause.translateX(190 * Math.cos(i));

      cube.lookAt(camera.position);
      play.lookAt(camera.position);
      pause.lookAt(camera.position);

      cube.playButton = play;
      cube.pauseButton = pause;

      cube.uri = track.uri;
      cubes.push(cube);
    }

    for (i = 0.0; i <= (Math.PI * 2); i += Math.PI / 6) {
      if (!tracksArray.length)
        return;

      track = tracksArray.pop();
      var material;

      if (track.artwork_url)
        material = new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture(track.artwork_url)
        });
      else
        material = new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/soundcloud.png")
        });

      var cube = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), material);
      var play = new THREE.Mesh(new THREE.PlaneGeometry(50, 50),
        new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/play102.png"),
          transparent: true,
          opacity: 0
        }));

      var pause = new THREE.Mesh(new THREE.PlaneGeometry(50, 50),
        new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/pause31.png"),
          transparent: true,
          opacity: 0
        }));

      cube.overdraw = true;
      obj.add(cube);
      obj.add(play);
      obj.add(pause);

      cube.translateZ(200 * Math.sin(i));
      cube.translateX(200 * Math.cos(i));
      cube.translateY(110);

      play.translateZ(190 * Math.sin(i));
      play.translateX(190 * Math.cos(i));
      play.translateY(105);

      pause.translateZ(190 * Math.sin(i));
      pause.translateX(190 * Math.cos(i));
      pause.translateY(105);

      cube.lookAt(camera.position);
      play.lookAt(camera.position);
      pause.lookAt(camera.position);

      cube.playButton = play;
      cube.pauseButton = pause;

      cube.uri = track.uri;
      cubes.push(cube);
    }

    for (i = 0.0; i <= (Math.PI * 2); i += Math.PI / 6) {
      if (!tracksArray.length)
        return;

      var track = tracksArray.pop();
      var material;

      if (track.artwork_url)
        material = new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture(track.artwork_url)
        });
      else
        materials = new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/soundcloud.png")
        });

      var cube = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), material);
      var play = new THREE.Mesh(new THREE.PlaneGeometry(50, 50),
        new THREE.MeshBasicMaterial({
          map: THREE.ImageUtils.loadTexture("../files/play102.png"),
          transparent: true,
          opacity: 0
        }));

      var pause = new THREE.Mesh(new THREE.PlaneGeometry(50, 50),
        new THREE.MeshLambertMaterial({
          map: THREE.ImageUtils.loadTexture("../files/pause31.png"),
          transparent: true,
          opacity: 0
        }));

      cube.overdraw = true;
      obj.add(cube);
      obj.add(play);
      obj.add(pause);


      cube.translateZ(200 * Math.sin(i));
      cube.translateX(200 * Math.cos(i));
      cube.translateY(-110);

      play.translateZ(190 * Math.sin(i));
      play.translateX(190 * Math.cos(i));
      play.translateY(-105);

      pause.translateZ(190 * Math.sin(i));
      pause.translateX(190 * Math.cos(i));
      pause.translateY(-105);

      cube.lookAt(camera.position);
      play.lookAt(camera.position);
      pause.lookAt(camera.position);

      cube.playButton = play;
      cube.pauseButton = pause;

      cube.uri = track.uri;
      cubes.push(cube);
    }

    obj.position = new THREE.Vector3(0, 0, 0);
    scene.add(obj);
    var currentIndex;
    var currentSound;
    var isPlaying = false;
    _.each(cubes, function(cube) {
      domEvents.addEventListener(cube, 'click', function(event) {
        var index = cubes.indexOf(cube);
        var current = cubes[index - 2];

        if (cubes.indexOf(cube) !== currentIndex) {
          console.log('Stop all');
          console.log('');
          SC.streamStopAll();
        }

        SC.stream(current.uri, function(sound) {

          if (isPlaying && cubes.indexOf(cube) == currentIndex) {
            currentSound.pause();
            console.log('isCube');
            console.log();
            isPlaying = false;
            trackPlaying = '';
            cubes[cubes.indexOf(cube) + 2].playButton.material.opacity = 1;
            cubes[cubes.indexOf(cube) + 2].pauseButton.material.opacity = 0;
            timeline.material.opacity = 0;
          } else {
            currentSound = sound;
            sound.play();
            isPlaying = true;
            currentIndex = cubes.indexOf(cube);
            console.log('Play this');
            console.log('');
            trackPlaying = current.uri;
            cubes[cubes.indexOf(cube) + 2].playButton.material.opacity = 0;
            cubes[cubes.indexOf(cube) + 2].pauseButton.material.opacity = 1;
            timeline.material.opacity = 1;               
          }
        });

}, false);

domEvents.addEventListener(cube, 'mouseover', function(event) {
  var index = cubes.indexOf(cube);
  if (index !== currentIndex)
    cubes[index + 2].playButton.material.opacity = 1;
  else {
    if(isPlaying)
      cubes[index + 2].pauseButton.material.opacity = 1;
    else 
      cubes[index + 2].playButton.material.opacity = 1;            
  }
}, false);

domEvents.addEventListener(cube, 'mouseout', function(event) {
  var index = cubes.indexOf(cube);
  var current = cubes[index - 2];

  cubes[index + 2].playButton.material.opacity = 0;
  cubes[index + 2].pauseButton.material.opacity = 0;
}, false);
    }); // Fin du for each
}


function createControls() {
  var controlObj = new THREE.Object3D();
  var voiceMaterial = new THREE.MeshLambertMaterial({
    map: THREE.ImageUtils.loadTexture("../files/micro1.jpg"),
  });
  var backMaterial = new THREE.MeshLambertMaterial({
    map: THREE.ImageUtils.loadTexture("../files/back28.png")
  });
  var homeMaterial = new THREE.MeshLambertMaterial({
    map: THREE.ImageUtils.loadTexture("../files/soundcloud.png")
  });
  var voice = new THREE.Mesh(new THREE.CircleGeometry(12, 45), voiceMaterial);
  var back = new THREE.Mesh(new THREE.CircleGeometry(12, 45), backMaterial);
  var home = new THREE.Mesh(new THREE.CircleGeometry(12, 45), homeMaterial);

  voice.translateX(75 * Math.cos(Math.PI / 3));
  voice.translateZ(75 * Math.sin(Math.PI / 3));
  voice.translateY(-100);
  voice.lookAt(camera.position);

  back.translateX(75 * Math.cos(-Math.PI / 3));
  back.translateZ(75 * Math.sin(-Math.PI / 3));
  back.translateY(-100);
  back.lookAt(camera.position);

  home.translateX(75 * Math.cos(0));
  home.translateZ(75 * Math.sin(0));
  home.translateY(-100);

  home.lookAt(camera.position);

  controlObj.add(voice);
  controlObj.add(back);
  controlObj.add(home);
  controlObj.position = new THREE.Vector3(0, 0, 0);
  scene.add(controlObj);
}

function createNavigation() {
  var controlObj = new THREE.Object3D();
  timeline = new THREE.Mesh(new THREE.PlaneGeometry(593, 140),
    new THREE.MeshLambertMaterial({
      map: THREE.ImageUtils.loadTexture("../files/trees-remix.png"),
      transparent: true,
      opacity: 0
    })
    );

  timeline.translateX(100 * Math.cos(0));
  timeline.translateY(320);
  timeline.translateZ(100 * Math.sin(0));
  timeline.lookAt(camera.position);
  timeline.rotateX(-Math.PI/12);

  controlObj.add(timeline);
  controlObj.position = new THREE.Vector3(0,0,0);
  scene.add(controlObj);
}

}

var url = document.URL.replace(/%20/gi, ' ').split('/');
var query = url[3];

SC.initialize({
    client_id: 'c1da0911d3af90cfd3153d5c6d030137'
});

tracksArray = new Array();
THREE.ImageUtils.crossOrigin = '';
getQuery();

SC.get('/tracks', {
    q: getQuery()
}, function(tracks) {

    tracksArray = tracks;
    createApp();

});

function getQuery() {
    return query;
}

function setQuery(value) {
    query = value;
}