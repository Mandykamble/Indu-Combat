import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { io } from 'socket.io-client';

const TRANSLATIONS = {
  "en-US": {
    "forestExplorerControlsTitle": "Indian Warriors Battle",
    "playerControls": "WASD - Move | Q - Attack | E - Block | Hold Right Mouse - Look Around",
    "exploreMessage": "Defeat your opponent with traditional Indian weapons!",
    "youWin": "You Win!",
    "opponentWins": "Opponent Wins!",
    "joinGame": "Join Game",
    "roomId": "Enter Room ID",
    "waiting": "Waiting for opponent...",
    "roomFull": "Room is full. Try another room."
  }
};

const SplitScreenExplorer = () => {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const playerRef = useRef(null);
  const opponentRef = useRef(null);
  const animationRef = useRef(null);
  const composerRef = useRef(null);
  const mouseXRef = useRef(0);
  const mouseYRef = useRef(0);
  const isRightMouseDownRef = useRef(false);
  const [playerHealth, setPlayerHealth] = useState(100);
  const [opponentHealth, setOpponentHealth] = useState(100);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const crowdRef = useRef([]);
  const [roomId, setRoomId] = useState('');
  const [gameState, setGameState] = useState('initial'); // initial, waiting, playing
  const [roomMessage, setRoomMessage] = useState('');
  const [opponentId, setOpponentId] = useState(null); // Track opponent ID
  const socketRef = useRef(null);

  const browserLocale = navigator.languages?.[0] || navigator.language || 'en-US';
  const findMatchingLocale = (locale) => {
    if (TRANSLATIONS[locale]) return locale;
    const lang = locale.split('-')[0];
    const match = Object.keys(TRANSLATIONS).find(key => key.startsWith(lang + '-'));
    return match || 'en-US';
  };
  const locale = findMatchingLocale(browserLocale);
  const t = (key) => TRANSLATIONS[locale]?.[key] || TRANSLATIONS['en-US'][key] || key;

  useEffect(() => {
    // socketRef.current = io('http://localhost:3001'); // Update to Vercel URL after deployment
    socketRef.current = io('https://indian-combat-backend.vercel.app');
    socketRef.current.on('updateRoom', (room) => {
      setGameState(room.gameState.started ? 'playing' : 'waiting');
      const players = room.players;
      const playerIds = Object.keys(players);
      const myId = socketRef.current.id;
      const newOpponentId = playerIds.find(id => id !== myId);

      setOpponentId(newOpponentId);

      if (players[myId]) {
        setPlayerHealth(players[myId].health);
        if (playerRef.current) {
          playerRef.current.position.set(
            players[myId].position.x,
            players[myId].position.y,
            players[myId].position.z
          );
          playerRef.current.rotation.set(
            players[myId].rotation.x,
            players[myId].rotation.y,
            players[myId].rotation.z
          );
          playerRef.current.userData.isAttacking = players[myId].isAttacking;
          playerRef.current.userData.isBlocking = players[myId].isBlocking;
          playerRef.current.userData.attackCooldown = players[myId].attackCooldown;
          playerRef.current.userData.attackAnimationProgress = players[myId].attackAnimationProgress;
          playerRef.current.userData.blockAnimationProgress = players[myId].blockAnimationProgress;
        }
      }

      if (newOpponentId && players[newOpponentId]) {
        setOpponentHealth(players[newOpponentId].health);
        if (!opponentRef.current) {
          const opponent = createPlayer(players[newOpponentId].isPlayer1 ? 0x0066cc : 0xcc0066, players[newOpponentId].isPlayer1);
          sceneRef.current.add(opponent);
          opponentRef.current = opponent;
        }
        opponentRef.current.position.set(
          players[newOpponentId].position.x,
          players[newOpponentId].position.y,
          players[newOpponentId].position.z
        );
        opponentRef.current.rotation.set(
          players[newOpponentId].rotation.x,
          players[newOpponentId].rotation.y,
          players[newOpponentId].rotation.z
        );
        opponentRef.current.userData.isAttacking = players[newOpponentId].isAttacking;
        opponentRef.current.userData.isBlocking = players[newOpponentId].isBlocking;
        opponentRef.current.userData.attackCooldown = players[newOpponentId].attackCooldown;
        opponentRef.current.userData.attackAnimationProgress = players[newOpponentId].attackAnimationProgress;
        opponentRef.current.userData.blockAnimationProgress = players[newOpponentId].blockAnimationProgress;
      } else {
        setOpponentHealth(100);
        if (opponentRef.current) {
          sceneRef.current.remove(opponentRef.current);
          opponentRef.current = null;
        }
      }
    });

    socketRef.current.on('roomFull', () => {
      setRoomMessage(t('roomFull'));
    });

    socketRef.current.on('gameOver', ({ winner: winnerId }) => {
      setGameOver(true);
      setWinner(winnerId === socketRef.current.id ? 'player' : 'opponent');
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, [t]);

  useEffect(() => {
    if (playerHealth <= 0) {
      setGameOver(true);
      setWinner('opponent');
    } else if (opponentHealth <= 0) {
      setGameOver(true);
      setWinner('player');
    }
  }, [playerHealth, opponentHealth]);

  const checkCollision = (player, newPosition, obstacles) => {
    const playerBox = new THREE.Box3().setFromObject(player);
    playerBox.min.set(playerBox.min.x - 0.5, playerBox.min.y, playerBox.min.z - 0.5);
    playerBox.max.set(playerBox.max.x + 0.5, playerBox.max.y, playerBox.max.z + 0.5);

    for (const obstacle of obstacles) {
      const obstacleBox = new THREE.Box3().setFromObject(obstacle);
      const tempBox = playerBox.clone();
      tempBox.min.set(newPosition.x - 0.5, playerBox.min.y, newPosition.z - 0.5);
      tempBox.max.set(newPosition.x + 0.5, playerBox.max.y, newPosition.z + 0.5);
      if (tempBox.intersectsBox(obstacleBox)) {
        return true;
      }
    }
    return false;
  };

  const updatePlayerMovement = (player, keys, obstacles, walkAnimation) => {
    let isMoving = false;
    const direction = new THREE.Vector3();

    if (keys['KeyW']) {
      direction.z -= 1;
      isMoving = true;
    }
    if (keys['KeyS']) {
      direction.z += 1;
      isMoving = true;
    }
    if (keys['KeyA']) {
      direction.x -= 1;
      isMoving = true;
    }
    if (keys['KeyD']) {
      direction.x += 1;
      isMoving = true;
    }

    if (isMoving) {
      direction.normalize();
      const newPosition = player.position.clone().add(direction.multiplyScalar(0.25));
      if (!checkCollision(player, newPosition, obstacles)) {
        player.position.x = newPosition.x;
        player.position.z = newPosition.z;
        const angle = Math.atan2(direction.x, direction.z);
        player.rotation.y = angle;
        socketRef.current.emit('move', {
          roomId,
          position: { x: newPosition.x, y: newPosition.y, z: newPosition.z },
          rotation: { x: player.rotation.x, y: player.rotation.y, z: player.rotation.z },
        });
      }

      walkAnimation.value += 0.3;
      const leftLeg = player.children[4];
      const rightLeg = player.children[5];
      const leftArm = player.children[2];
      const rightArm = player.children[3];

      leftLeg.rotation.x = Math.sin(walkAnimation.value) * 0.5;
      rightLeg.rotation.x = Math.sin(walkAnimation.value + Math.PI) * 0.5;
      leftArm.rotation.x = Math.sin(walkAnimation.value + Math.PI) * 0.3;
      rightArm.rotation.x = Math.sin(walkAnimation.value) * 0.3;
    } else {
      const leftLeg = player.children[4];
      const rightLeg = player.children[5];
      const leftArm = player.children[2];
      const rightArm = player.children[3];

      leftLeg.rotation.x *= 0.9;
      rightLeg.rotation.x *= 0.9;
      leftArm.rotation.x *= 0.9;
      rightArm.rotation.x *= 0.9;
    }

    if (player.userData.isAttacking) {
      player.userData.attackAnimationProgress += 0.1;
      const t = player.userData.attackAnimationProgress;
      if (t <= 1) {
        const angle = -Math.PI / 4 + Math.sin(t * Math.PI) * Math.PI / 2;
        player.userData.talwar.rotation.z = angle;
        player.userData.talwar.position.set(1.5 + Math.sin(t * Math.PI) * 0.5, 2.5, Math.cos(t * Math.PI) * 0.5);
      } else {
        player.userData.isAttacking = false;
        player.userData.talwar.position.set(1.5, 2.5, 0);
        player.userData.talwar.rotation.z = -Math.PI / 4;
      }
    } else if (player.userData.isBlocking) {
      player.userData.blockAnimationProgress += 0.05;
      const t = player.userData.blockAnimationProgress;
      const oscillation = Math.sin(t * Math.PI * 2) * 0.1;
      player.userData.dhal.position.set(-1, 3 + oscillation, 0.5);
      player.userData.dhal.rotation.y = Math.PI / 2;
      player.userData.dhal.rotation.z = Math.PI / 4 + oscillation;
    } else {
      player.userData.talwar.position.set(1.5, 2.5, 0);
      player.userData.talwar.rotation.z = -Math.PI / 4;
      player.userData.dhal.position.set(-1.5, 2.5, 0);
      player.userData.dhal.rotation.set(0, 0, Math.PI / 4);
    }
  };

  const updateMovement = (obstacles, walkAnimation, keys, sparks) => {
    if (!gameOver && gameState === 'playing' && playerRef.current) {
      updatePlayerMovement(playerRef.current, keys, obstacles, walkAnimation);
    }

    if (isRightMouseDownRef.current && cameraRef.current) {
      cameraRef.current.rotation.y += mouseXRef.current * 0.02;
      cameraRef.current.rotation.x = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, cameraRef.current.rotation.x + mouseYRef.current * 0.02));
    }

    if (playerRef.current && cameraRef.current) {
      const idealCameraPosition = new THREE.Vector3(
        playerRef.current.position.x,
        playerRef.current.position.y + 8,
        playerRef.current.position.z + 15
      );
      cameraRef.current.position.lerp(idealCameraPosition, 0.05);
      cameraRef.current.lookAt(playerRef.current.position.x, playerRef.current.position.y + 2, playerRef.current.position.z);
    }
  };

  const animate = (obstacles, walkAnimation, keys, sparks) => {
    if (gameOver) return;
    animationRef.current = requestAnimationFrame(() => animate(obstacles, walkAnimation, keys, sparks));
    updateMovement(obstacles, walkAnimation, keys);

    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      spark.userData.lifetime--;
      spark.scale.multiplyScalar(0.95);
      if (spark.userData.lifetime <= 0) {
        sceneRef.current.remove(spark);
        if (spark.userData.light) sceneRef.current.remove(spark.userData.light);
        sparks.splice(i, 1);
      }
    }

    crowdRef.current.forEach((person, index) => {
      person.rotation.y += 0.01;
      person.position.y = 0.5 + Math.sin(Date.now() * 0.001 + index) * 0.1;
    });

    composerRef.current.render();
  };

  const createCrowdMember = (x, z) => {
    const group = new THREE.Group();
    const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.5, 1.5, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5),
      roughness: 0.8,
      metalness: 0.1
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.75;
    group.add(body);

    const headGeometry = new THREE.SphereGeometry(0.35, 16, 16);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xffdbac,
      roughness: 0.7,
      metalness: 0.1
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.8;
    group.add(head);

    group.position.set(x, 0, z);
    group.scale.set(0.8, 0.8, 0.8);
    return group;
  };

  const createArena = (scene) => {
    const arenaGeometry = new THREE.CircleGeometry(30, 32);
    const arenaTexture = new THREE.TextureLoader().load('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABYSURBVFhH7dJBDQAgCAAdo6v//zV7AIJA7YGBG7j6eQDLBl5WAAAAAElFTkSuQmCC');
    arenaTexture.wrapS = arenaTexture.wrapT = THREE.RepeatWrapping;
    arenaTexture.repeat.set(4, 4);
    const arenaMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513,
      map: arenaTexture,
      roughness: 0.8,
      metalness: 0.1
    });
    const arena = new THREE.Mesh(arenaGeometry, arenaMaterial);
    arena.rotation.x = -Math.PI / 2;
    arena.position.y = 0.05;
    arena.receiveShadow = true;
    scene.add(arena);

    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const x = Math.cos(angle) * 32;
      const z = Math.sin(angle) * 32;

      const pillarGeometry = new THREE.CylinderGeometry(0.8, 1, 6, 16);
      const pillarMaterial = new THREE.MeshStandardMaterial({
        color: 0xcd7f32,
        roughness: 0.7,
        metalness: 0.3
      });
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.position.set(x, 3, z);
      pillar.castShadow = true;
      scene.add(pillar);

      if (i % 4 === 0) {
        const torchGeometry = new THREE.SphereGeometry(0.5, 16, 16);
        const torchMaterial = new THREE.MeshBasicMaterial({
          color: 0xff6600,
          emissive: 0xff5500,
          emissiveIntensity: 0.5
        });
        const torch = new THREE.Mesh(torchGeometry, torchMaterial);
        torch.position.set(0, 4, 0);
        pillar.add(torch);

        const torchLight = new THREE.PointLight(0xff6600, 1, 10);
        torchLight.position.set(0, 4, 0);
        pillar.add(torchLight);
      }
    }

    const crowd = [];
    for (let i = 0; i < 50; i++) {
      const angle = (i / 50) * Math.PI * 2;
      const radius = 35 + Math.random() * 5;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const crowdMember = createCrowdMember(x, z);
      crowdMember.rotation.y = -angle + Math.PI;
      scene.add(crowdMember);
      crowd.push(crowdMember);
    }
    crowdRef.current = crowd;

    return arena;
  };

  const createTalwar = () => {
    const group = new THREE.Group();
    const bladeGeometry = new THREE.CylinderGeometry(0.05, 0.2, 2, 16);
    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: 0xAAAAAA,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x222222,
      emissiveIntensity: 0.1
    });
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade.rotation.x = Math.PI / 2;
    blade.position.set(0, 0, 1);
    group.add(blade);

    const hiltGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.5, 16);
    const hiltMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513,
      roughness: 0.7,
      metalness: 0.3
    });
    const hilt = new THREE.Mesh(hiltGeometry, hiltMaterial);
    hilt.rotation.x = Math.PI / 2;
    hilt.position.set(0, 0, -0.25);
    group.add(hilt);

    const guardGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.1);
    const guardMaterial = new THREE.MeshStandardMaterial({
      color: 0xFFD700,
      metalness: 0.8,
      roughness: 0.3
    });
    const guard = new THREE.Mesh(guardGeometry, guardMaterial);
    guard.position.set(0, 0, 0);
    group.add(guard);

    return group;
  };

  const createDhal = () => {
    const group = new THREE.Group();
    const shieldGeometry = new THREE.CylinderGeometry(1, 1, 0.2, 32);
    const shieldMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B0000,
      metalness: 0.7,
      roughness: 0.4
    });
    const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
    shield.rotation.x = Math.PI / 2;
    group.add(shield);

    const bossGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 16);
    const bossMaterial = new THREE.MeshStandardMaterial({
      color: 0xFFD700,
      metalness: 0.8,
      roughness: 0.3
    });
    const boss = new THREE.Mesh(bossGeometry, bossMaterial);
    boss.rotation.x = Math.PI / 2;
    group.add(boss);

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const spikeGeometry = new THREE.ConeGeometry(0.1, 0.3, 8);
      const spikeMaterial = new THREE.MeshStandardMaterial({
        color: 0xFFD700,
        metalness: 0.8,
        roughness: 0.3
      });
      const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
      spike.rotation.x = Math.PI / 2;
      spike.position.set(Math.cos(angle) * 0.7, Math.sin(angle) * 0.7, 0);
      group.add(spike);
    }

    return group;
  };

  const createSpark = (position) => {
    const sparkGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const sparkMaterial = new THREE.MeshBasicMaterial({
      color: 0xFFFF00,
      transparent: true,
      opacity: 0.8
    });
    const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
    spark.position.copy(position);
    spark.userData.lifetime = 20;
    sceneRef.current.add(spark);

    const sparkLight = new THREE.PointLight(0xFFFF00, 1, 2);
    sparkLight.position.copy(position);
    sceneRef.current.add(sparkLight);
    spark.userData.light = sparkLight;

    return spark;
  };

  const createPlayer = (color, isPlayer1) => {
    const group = new THREE.Group();

    const bodyGeometry = new THREE.CapsuleGeometry(0.8, 1.5, 8, 16);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.6,
      metalness: 0.2
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 1.5;
    body.castShadow = true;
    group.add(body);

    const headGeometry = new THREE.SphereGeometry(0.7, 16, 16);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xffdbac,
      roughness: 0.7,
      metalness: 0.1
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 3.2;
    head.castShadow = true;
    group.add(head);

    const turbanGeometry = new THREE.TorusGeometry(0.75, 0.2, 16, 32, Math.PI);
    const turbanMaterial = new THREE.MeshStandardMaterial({
      color: isPlayer1 ? 0x0000ff : 0xff0000,
      roughness: 0.7,
      metalness: 0.1
    });
    const turban = new THREE.Mesh(turbanGeometry, turbanMaterial);
    turban.position.y = 3.7;
    turban.rotation.x = Math.PI / 2;
    head.add(turban);

    const armGeometry = new THREE.CapsuleGeometry(0.2, 1.2, 8, 16);
    const armMaterial = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.6,
      metalness: 0.2
    });
    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(-1.2, 2, 0);
    leftArm.rotation.z = Math.PI / 6;
    leftArm.castShadow = true;
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(1.2, 2, 0);
    rightArm.rotation.z = -Math.PI / 6;
    rightArm.castShadow = true;
    group.add(rightArm);

    const legGeometry = new THREE.CapsuleGeometry(0.3, 1.5, 8, 16);
    const legMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513,
      roughness: 0.7,
      metalness: 0.1
    });
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.5, 0.2, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.5, 0.2, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    const talwar = createTalwar();
    talwar.position.set(1.5, 2.5, 0);
    talwar.rotation.z = -Math.PI / 4;
    group.add(talwar);
    group.userData.talwar = talwar;

    const dhal = createDhal();
    dhal.position.set(-1.5, 2.5, 0);
    dhal.rotation.z = Math.PI / 4;
    group.add(dhal);
    group.userData.dhal = dhal;

    group.userData.isAttacking = false;
    group.userData.isBlocking = false;
    group.userData.attackCooldown = 0;
    group.userData.attackAnimationProgress = 0;
    group.userData.blockAnimationProgress = 0;
    group.userData.isPlayer1 = isPlayer1;

    group.position.y = 2;
    return group;
  };

  useEffect(() => {
    if (gameState !== 'playing') return;

    const keys = {};
    const walkAnimation = { value: 0 };
    const sparks = [];

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x004f00, 50, 200);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 8, 15);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x87CEEB);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const mount = mountRef.current;
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3,
      0.4,
      0.85
    ));
    composerRef.current = composer;

    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xfff5c1, 0.8);
    directionalLight1.position.set(50, 50, -50);
    directionalLight1.castShadow = true;
    directionalLight1.shadow.camera.near = 0.1;
    directionalLight1.shadow.camera.far = 500;
    directionalLight1.shadow.camera.left = -100;
    directionalLight1.shadow.camera.right = 100;
    directionalLight1.shadow.camera.top = 100;
    directionalLight1.shadow.camera.bottom = -100;
    scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xaaaaaa, 0.3);
    directionalLight2.position.set(-50, 30, 50);
    scene.add(directionalLight2);

    const arena = createArena(scene);

    const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x1E90FF) },
        bottomColor: { value: new THREE.Color(0x87CEEB) },
        offset: { value: 33 },
        exponent: { value: 0.6 },
        time: { value: 0 }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        uniform float time;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          vec3 color = mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
          float cloud = sin(vWorldPosition.x * 0.01 + time * 0.001) * 
                       cos(vWorldPosition.z * 0.01 + time * 0.001) * 0.1;
          color += max(cloud, 0.0);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide
    });
    const skybox = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(skybox);

    const groundGeometry = new THREE.PlaneGeometry(1000, 1000, 32, 32);
    const groundTexture = new THREE.TextureLoader().load('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABYSURBVFhH7dJBDQAgCAAdo6v//zV7AIJA7YGBG7j6eQDLBl5WAAAAAElFTkSuQmCC');
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(50, 50);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x567d46,
      map: groundTexture,
      roughness: 0.8,
      metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);

    // Create player (will be updated with correct position/color by server)
    const player = createPlayer(0x0066cc, true); // Default color, updated later
    scene.add(player);
    playerRef.current = player;

    const obstacles = [arena];

    const handleKeyDown = (e) => {
      if (gameState !== 'playing') return;
      keys[e.code] = true;
      if (e.code === 'KeyQ' && playerRef.current.userData.attackCooldown <= 0) {
        socketRef.current.emit('attack', { roomId });
        if (opponentRef.current && opponentId) {
          const distance = playerRef.current.position.distanceTo(opponentRef.current.position);
          if (distance < 5 && !opponentRef.current.userData.isBlocking) {
            socketRef.current.emit('updateHealth', { roomId, targetId: opponentId, damage: 20 });
            const sparkPos = opponentRef.current.position.clone().add(new THREE.Vector3(0, 2, 0));
            sparks.push(createSpark(sparkPos));
          }
        }
      }
      if (e.code === 'KeyE') {
        socketRef.current.emit('block', { roomId, isBlocking: true });
      }
    };

    const handleKeyUp = (e) => {
      if (gameState !== 'playing') return;
      keys[e.code] = false;
      if (e.code === 'KeyE') {
        socketRef.current.emit('block', { roomId, isBlocking: false });
      }
    };

    const handleMouseMove = (e) => {
      mouseXRef.current = (e.movementX / window.innerWidth) * 2;
      mouseYRef.current = (e.movementY / window.innerHeight) * 2;
    };

    const handleMouseDown = (e) => {
      if (e.button === 2) {
        isRightMouseDownRef.current = true;
        document.body.style.cursor = 'grabbing';
      }
    };

    const handleMouseUp = (e) => {
      if (e.button === 2) {
        isRightMouseDownRef.current = false;
        document.body.style.cursor = 'default';
      }
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('contextmenu', handleContextMenu);

    animate(obstacles, walkAnimation, keys, sparks);

    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      renderer.setSize(width, height);
      composerRef.current.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('contextmenu', handleContextMenu);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (mount && renderer.domElement) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [gameState, gameOver, roomId, animate, createArena]);

  const handleJoinRoom = () => {
    if (roomId.trim()) {
      socketRef.current.emit('joinRoom', roomId);
      setRoomMessage('');
    }
  };

  const restartGame = () => {
    setPlayerHealth(100);
    setOpponentHealth(100);
    setGameOver(false);
    setWinner(null);
    setGameState('initial');
    setRoomId('');
    setOpponentId(null);
    if (playerRef.current) {
      playerRef.current.position.set(-10, 2, 0);
      playerRef.current.userData.isAttacking = false;
      playerRef.current.userData.isBlocking = false;
      playerRef.current.userData.attackCooldown = 0;
      playerRef.current.userData.attackAnimationProgress = 0;
      playerRef.current.userData.blockAnimationProgress = 0;
    }
    if (opponentRef.current) {
      sceneRef.current.remove(opponentRef.current);
      opponentRef.current = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <style>
        {`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
              'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
          }
          .health-bar {
            width: 150px;
            height: 20px;
            background-color: #333;
            border: 2px solid #fff;
            border-radius: 8px;
            overflow: hidden;
            margin-top: 8px;
            box-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
          }
          .health-fill {
            height: 100%;
            background: linear-gradient(to right, #4CAF50, #8BC34A);
            transition: width 0.3s ease-in-out;
          }
          .health-container {
            position: absolute;
            z-index: 20;
            pointer-events: none;
            background-color: rgba(0, 0, 0, 0.7);
            border-radius: 8px;
            padding: 10px;
          }
          .game-over, .room-join {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 30px;
            border-radius: 12px;
            text-align: center;
            z-index: 100;
            box-shadow: 0 0 20px rgba(255, 215, 0, 0.5);
            border: 2px solid gold;
            pointer-events: auto;
          }
          .player-ui {
            left: 20px;
            top: 20px;
            border: 2px solid #0066cc;
          }
          .opponent-ui {
            right: 20px;
            top: 20px;
            border: 2px solid #cc0066;
          }
          .input-field {
            background: #333;
            color: white;
            border: 2px solid #fff;
            border-radius: 8px;
            padding: 8px;
            margin: 10px 0;
            width: 200px;
            font-size: 16px;
          }
          .join-btn, .restart-btn {
            background: linear-gradient(to bottom, #ff6b6b, #c0392b);
            border: none;
            color: white;
            padding: 12px 24px;
            text-align: center;
            text-decoration: none;
            display: inline-block;
            font-size: 16px;
            margin: 10px 2px;
            cursor: pointer;
            border-radius: 8px;
            transition: all 0.3s;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .join-btn:hover, .restart-btn:hover {
            background: linear-gradient(to bottom, #ff5252, #b83224);
            transform: translateY(-2px);
            box-shadow: 0 6px 8px rgba(0, 0, 0, 0.2);
          }
        `}
      </style>
      <div ref={mountRef} className="w-full h-full" />

      {gameState === 'initial' && (
        <div className="room-join">
          <h2 className="text-xl font-bold mb-4 text-yellow-300">{t('joinGame')}</h2>
          <input
            type="text"
            className="input-field"
            placeholder={t('roomId')}
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <button className="join-btn" onClick={handleJoinRoom}>
            {t('joinGame')}
          </button>
          {roomMessage && <p className="text-red-300 mt-2">{roomMessage}</p>}
        </div>
      )}

      {gameState === 'waiting' && (
        <div className="room-join">
          <h2 className="text-xl font-bold mb-4 text-yellow-300">{t('waiting')}</h2>
          <p className="text-sm">Room ID: {roomId}</p>
        </div>
      )}

      {gameState === 'playing' && (
        <>
          <div className="health-container player-ui">
            <h3 className="text-xl font-bold mb-2 text-blue-300">You</h3>
            <p className="text-sm mb-2 text-white">{t('playerControls')}</p>
            <div className="flex items-center">
              <span className="mr-2 text-sm text-white">Health:</span>
              <div className="health-bar">
                <div className="health-fill" style={{ width: `${playerHealth}%` }} />
              </div>
            </div>
          </div>

          {opponentHealth < 100 && (
            <div className="health-container opponent-ui">
              <h3 className="text-xl font-bold mb-2 text-pink-300">Opponent</h3>
              <div className="flex items-center">
                <span className="mr-2 text-sm text-white">Health:</span>
                <div className="health-bar">
                  <div className="health-fill" style={{ width: `${opponentHealth}%` }} />
                </div>
              </div>
            </div>
          )}

          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-80 text-white p-4 rounded text-center z-20">
            <h2 className="text-xl font-bold mb-2 text-yellow-300">{t('forestExplorerControlsTitle')}</h2>
            <p className="text-sm">{t('exploreMessage')}</p>
          </div>
        </>
      )}

      {gameOver && (
        <div className="game-over">
          <h2 className="text-3xl font-bold mb-4 text-yellow-300">{winner === 'player' ? t('youWin') : t('opponentWins')}</h2>
          <button className="restart-btn" onClick={restartGame}>
            Play Again
          </button>
        </div>
      )}
    </div>
  );
};

export default SplitScreenExplorer;