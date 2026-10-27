# Using Assets
To load an asset, you must import the `GLTFLoader` addon. Note that the models might need to be scaled and rotated.

## Player Animations
The current animations that the user can play are "WalkCycle", "SwingRight", and "SwingLeft". To use them, you must first create an `AnimationMixer` object. You can then load the animation by calling `AnimationClip.findByName()` and passing in the name of the animation as the argument. To create the animation in-game, you call the `mixer.clipAction()` method on the mixer object with clip from the `findByName()` call. Note that playing animations uses the `play()` method, which MUST call `stop()` before playing it again in the future.

To render animations, you have to update the mixer in the render loop. There are multiple ways to do this, but here is how I did it: import `Timer` and initialize one before the render loop. At the start of the render after `requestAnimationFrame(animate)`, call `timer.update()`. At the end right before calling `renderer.render(scene, camera)` call `mixer.update(timer.getDelta())`.

For future development, overhead swings and a diving swing will be created for more movement options.

## Attaching to the player model
To attach the racket, use the "HandSocket" object. This can be grabbed by calling the `getObjectByName()` method on the player loaded by the `GLTFLoader` (make sure it's of the `scene` field after loading). Once you also load the racket with the `GLTFLoader`, call the `socket.add()` method on the socket by passing in the file name of the racket as the argument.

Attached models can rotate relative to the socket axis. This means that rotating the racket about the y-axis will rotate it properly relative to the hand, instead of the global y-axis.

For future development, a "HeadSocket" will be created for attaching hats to the player model.

## Model files

The player and racket GLBs are stored in `public/assets/` so Vite includes them
in production builds. Their runtime URLs are `/assets/player.glb` and
`/assets/racket.glb`. This directory retains model usage documentation.
