// Wii U adapter buttons1: A=bit 0, B=bit 1 (Dolphin GCAdapter.cpp).
export class ControllerControls {
  constructor(){this.reset();}
  reset(){this.previous=null;this.previousShoulder=null;this.triggerRest=null;}
  update(buttons){
    const current=buttons & 3;
    const pressed=this.previous===null?0:current & ~this.previous;
    this.previous=current;
    return {start:!!(pressed & 1),stop:!!(pressed & 2)};
  }
}
