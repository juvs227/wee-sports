# Using Assets
To load an asset, you must import the `GLTFLoader` addon. Note that the models might need to be scaled and rotated.

## Player Animations
The current animations that the user can play are "WalkCycle", "SwingRight", and "SwingLeft", "OverheadRight", and "Overheadleft". To use them, you must first create an `AnimationMixer` object. You can then load the animation by calling `AnimationClip.findByName()` and passing in the name of the animation as the argument. To create the animation in-game, you call the `mixer.clipAction()` method on the mixer object with clip from the `findByName()` call. Note that playing animations uses the `play()` method, which MUST call `stop()` before playing it again in the future. Playing two or more animations at the same time will create visual defects of the player model and is not advised.

To render animations, you have to update the mixer in the render loop. There are multiple ways to do this, but here is how I did it: import `Timer` and initialize one before the render loop. At the start of the render after `requestAnimationFrame(animate)`, call `timer.update()`. At the end right before calling `renderer.render(scene, camera)` call `mixer.update(timer.getDelta())`.

To add newly created animations, you must load both the player and animation(s) separately using the `GLTFLoader`. Once the animations are created after calling `mixer.clipAction()`, the animation will play as normal if exported properly.

## Racket model
For accessing different parts of the racket, there is the frame called "RacketFrame" and the wire called "RacketWire".

The natural position of the racket is at an angle, so manual adjustment by calling `racket.rotation.y` after attached.

## Attaching to the player model
To attach the racket, use the "HandSocket" object. This can be grabbed by calling the `getObjectByName()` method on the player loaded by the `GLTFLoader` (make sure it's of the `scene` field after loading). Once you also load the racket with the `GLTFLoader`, call the `socket.add()` method on the socket by passing in the file name of the racket as the argument.

Attached models can rotate relative to the socket axis. This means that rotating the racket about the y-axis will rotate it properly relative to the hand, instead of the global y-axis.

For future development, a "HeadSocket" will be created for attaching hats to the player model.

## Model files
The player and racket GLBs are stored in `public/assets/` and animations are stored in `public/assets/animations/` so Vite includes them
in production builds. Their runtime URLs are `/assets/player.glb` and
`/assets/racket.glb`. This directory retains model usage documentation.


# Animation Development
To create new models, first download [Blender](https://www.blender.org/download/) and use it to edit `player.blend` after creating a copy.

## Creating Animations
Keyframe the animation using the armature that the player is attached to. The name of the action created here will be the same name that can be looked up in the code. There is a script that will mirror an animation in the scripting tab. First, copy the animation to be mirrored into a new action, select the arm and hand bones in Pose mode with the default position, then hit the play button.

## Exporting Animations
When exporting, first select only the armature and not the player model in Object mode. Then go to `File/Export/glTF 2.0 (.glb/.gltf)`. In the export menu, under `Include`, you must select `Limit to: Selected Objects` so that only the armature is exported. Under the `Animation` tab, make sure it is selected if it isn't already and have `Animation Mode` is selected as `Actions`. The rest of the options should be the default options. Changing armature bone names or armature-player relationships will cause undefined behavior, so this should be avoided for consistency.
