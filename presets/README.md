# Creating and sharing presets

You can create presets in the trainer or build the preset folder manually.

## In the trainer

1. Click **Create new** next to the preset tabs and drop in an MP4, WebM, or MOV clip (2 to 60 seconds, up to 250 MB). Use 60 FPS footage when possible. The timeline always uses 60 frames per second.
2. Step through the clip to the first visible hit spark, then advance one frame. Click **Add hitlag window** and enter the number of hitlag frames. Repeat for each hit you want to mark.
3. Use **Add DI marker** on any frame where you want to record DI.
4. Click **Save preset** and give it a unique name. The trainer creates the preset folder for you and adds it to the preset list.

## Manually

Create a folder inside `presets` with one video (`.mp4`, `.webm`, or `.mov`) and one UTF-8 `.txt` file. The TXT file should follow this format.

```text
SDI-LAB-SEQUENCE 3
name My Combo
video My Combo.mp4
fps 60
frames 360
window 60 12 180
di_frames 170 300
```

- `name` is the unique name shown in the trainer. Keep it the same to retain attempt history and personal bests.
- `video` must match the filename in the folder. Spaces are supported.
- `fps` must be 60. Set `frames` to the clip length on that timeline, from 120 to 3600 frames (2 to 60 seconds).
- Each `window` line gives the start frame, the length in frames, and the escape direction in degrees. Frame numbering starts at 0. Windows must fit within the clip and cannot overlap.
- `di_frames` is optional and lists the frames where the trainer records DI. Optional `order 8` sets the tab order. Comments start with `#`.

## Sharing and installing presets

Share the whole preset folder. If you received a ZIP, extract it first. Put the extracted preset folder inside `presets` and refresh the trainer page.
