export const DIRECTION_OPTIONS = Object.freeze([
  { angle: 0, label: "→ Right" },
  { angle: 45, label: "↗ Up-right" },
  { angle: 90, label: "↑ Up" },
  { angle: 135, label: "↖ Up-left" },
  { angle: 180, label: "← Left" },
  { angle: 225, label: "↙ Down-left" },
  { angle: 270, label: "↓ Down" },
  { angle: 315, label: "↘ Down-right" },
]);

export function sequenceFromDrill(drill) {
  return {
    name: drill.name || "Custom",
    durationSeconds: drill.durationFrames / 60,
    hits: drill.hits.map((hit) => ({
      timeSeconds: hit.startFrame / 60,
      lengthFrames: hit.lengthFrames,
      directions: [hit.angle ?? hit.targets?.[0]?.angle ?? 180],
    })),
  };
}

export function drillFromSequence(sequence) {
  const durationFrames = Math.max(120, Math.round(Number(sequence.durationSeconds) * 60));
  const hits = sequence.hits
    .map((hit) => ({
      timeSeconds: Math.max(0, Number(hit.timeSeconds)),
      lengthFrames: Math.max(1, Math.round(Number(hit.lengthFrames))),
      directions: hit.directions.map(Number).filter((angle) => Number.isFinite(angle)).slice(0, 3),
    }))
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((hit, index) => {
      const startFrame = Math.round(hit.timeSeconds * 60);
      const directions = hit.directions.length ? hit.directions : [180];
      return {
        id: `hit-${index + 1}`,
        startFrame,
        lengthFrames: hit.lengthFrames,
        angle: ((directions[0] % 360) + 360) % 360,
        targets: [],
      };
    })
    .filter((hit) => hit.startFrame < durationFrames);
  for(let i=0;i<hits.length;i++){if(hits[i].startFrame+hits[i].lengthFrames>durationFrames)throw new Error("Window exceeds duration.");if(i && hits[i].startFrame<hits[i-1].startFrame+hits[i-1].lengthFrames)throw new Error("Hitlag windows cannot overlap.");}
  return { durationFrames, hits };
}

export function serializeSequence(sequence) {
 const lines=["SDI-LAB-SEQUENCE 3", `name ${(sequence.name||"Custom").replace(/[\r\n]/g," ")}`, "fps 60", `frames ${Math.round(sequence.durationSeconds*60)}`, "# window <start_frame> <duration_frames> <escape_degrees>"];
 if(sequence.video)lines.splice(2,0,`video ${sequence.video}`);
 if(sequence.order!==undefined)lines.splice(2,0,`order ${sequence.order}`);
 if(sequence.diFrames?.length)lines.splice(2,0,`di_frames ${sequence.diFrames.join(" ")}`);
 for(const h of sequence.hits)lines.push(`window ${Math.round(h.timeSeconds*60)} ${Math.round(h.lengthFrames)} ${h.directions[0]??180}`);
 return lines.join("\n")+"\n";
}
export function parseSequence(text) {
 const sequence={durationSeconds:10,hits:[]};
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith("#")||line.startsWith("SDI-LAB-SEQUENCE"))continue;
  const parts=line.split(/\s+/),[key]=parts;
  if(key==="name"){sequence.name=parts.slice(1).join(" ");continue;}
  if(key==="video"){sequence.video=parts.slice(1).join(" ");continue;}
  if(key==="order"){sequence.order=Number(parts[1]);if(!Number.isFinite(sequence.order))throw new Error("Invalid preset order.");continue;}
  if(key==="di_frames"){sequence.diFrames=parts.slice(1).map(Number);if(!sequence.diFrames.length||sequence.diFrames.some(f=>!Number.isInteger(f)||f<0))throw new Error("Invalid DI frames.");continue;}
  if(key==="fps"){if(Number(parts[1])!==60)throw new Error("Only 60 FPS sequences are supported.");continue;}
  if(key==="duration"||key==="frames") {const d=Number(parts[1])/(key==="frames"?60:1);if(!Number.isFinite(d)||d<2||d>60)throw new Error("Duration must be between 2 and 60 seconds.");sequence.durationSeconds=d;}
  else if(key==="hit"||key==="window"){
   if(parts.length<4)throw new Error("Incomplete hit line.");
   const timeSeconds=Number(parts[1])/(key==="window"?60:1),lengthFrames=Number(parts[2]),directions=parts[3].split(",").map(Number);
   if(!Number.isFinite(timeSeconds)||timeSeconds<0||!Number.isFinite(lengthFrames)||lengthFrames<1||directions.some(a=>!Number.isFinite(a)))throw new Error("Invalid window values.");
   sequence.hits.push({timeSeconds,lengthFrames,directions:[directions[0]]});
  }else throw new Error(`Unknown sequence line: ${line}`);
 }
 if(!sequence.hits.length)throw new Error("The sequence contains no hit elements.");
 drillFromSequence(sequence);return sequence;
}
