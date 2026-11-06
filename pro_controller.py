"""Wired Nintendo Switch Pro Controller reader using SDL's HIDAPI driver.
SDL owns protocol initialization and device calibration. No virtual Xbox driver.
"""
import collections
import ctypes
import threading
import time


def normalized_axis(value):
    return max(-1.0, min(1.0, value / (32768.0 if value < 0 else 32767.0)))


def controller_port(axes, buttons):
    # SDL label-based A/B/X/Y map onto the existing trainer command bits.
    b1 = sum(bit for index, bit in [(0,1),(1,2),(2,4),(3,8),(13,16),(14,32),(12,64),(11,128)] if buttons[index])
    b2 = (1 if buttons[6] else 0) | (4 if buttons[10] else 0) | (8 if buttons[9] else 0)
    main = {'x': normalized_axis(axes[0]), 'y': -normalized_axis(axes[1])}
    c = {'x': normalized_axis(axes[2]), 'y': -normalized_axis(axes[3])}
    return {'port':1,'connected':True,'controllerType':'pro-usb','buttons1':b1,'buttons2':b2,
            'triggerL':255 if axes[4]>16384 else 0,'triggerR':255 if axes[5]>16384 else 0,
            'stickX':round(128+main['x']*100),'stickY':round(128+main['y']*100),
            'cStickX':round(128+c['x']*100),'cStickY':round(128+c['y']*100),
            'normalizedStick':main,'normalizedCStick':c}


class ControllerEventBatch:
    """Keep same-report chords together without discarding button transitions."""
    def __init__(self, axes, buttons, publish):
        self.axes, self.buttons, self.publish = axes, buttons, publish
        self.timestamp = None
        self.changed_buttons = set()

    def flush(self):
        if self.timestamp is not None:
            self.publish(self.axes, self.buttons, self.timestamp)
        self.timestamp = None
        self.changed_buttons.clear()

    def update(self, kind, index, value, timestamp):
        # SDL can stamp several queued hardware reports with the same time.
        # A second event for one button is a new transition, not a chord.
        if self.timestamp is not None and (timestamp != self.timestamp or
                (kind == 'button' and index in self.changed_buttons)):
            self.flush()
        if kind == 'button':
            self.buttons[index] = bool(value)
            self.changed_buttons.add(index)
        else:
            self.axes[index] = value
        self.timestamp = timestamp


class ProControllerService:
    def __init__(self):
        self._lock=threading.Lock()
        self._stop=threading.Event()
        self._thread=None
        self._samples=collections.deque(maxlen=2048)
        self._sequence=0
        self._status={'state':'idle','stage':'waiting','message':'Connect a wired Pro Controller.','device':None,'pollRate':0}

    def status(self):
        with self._lock:return dict(self._status)

    def _set_status(self, **values):
        with self._lock:self._status.update(values)

    def samples_after(self, sequence):
        with self._lock:return {'samples':[s for s in self._samples if s['seq']>sequence],'latestSequence':self._sequence,'status':dict(self._status)}

    def request_connect(self):
        if self._thread and self._thread.is_alive():return
        self._stop.clear()
        with self._lock:
            self._samples.clear();self._sequence=0
            self._status.update(state='connecting',stage='SDL HIDAPI',message='Looking for a wired Nintendo Pro Controller…',device=None)
        self._thread=threading.Thread(target=self._run,name='Wired Pro Controller reader',daemon=True)
        self._thread.start()

    def request_disconnect(self):
        self._stop.set()
        if self._thread:self._thread.join(timeout=3)
        self._set_status(state='idle',stage='waiting',message='Pro Controller disconnected.',device=None)

    def stop(self):self.request_disconnect()

    def _publish(self, axes, buttons, timestamp):
        with self._lock:
            self._sequence+=1
            self._samples.append({'seq':self._sequence,'timestamp':timestamp,'ports':[controller_port(axes,buttons)]})

    def _run(self):
        sdl=None;controller=None;initialized=False
        try:
            import sdl2 as sdl
            for key,value in [(b'SDL_JOYSTICK_HIDAPI',b'1'),(b'SDL_JOYSTICK_HIDAPI_SWITCH',b'1'),(b'SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS',b'1'),(b'SDL_GAMECONTROLLER_USE_BUTTON_LABELS',b'1')]:sdl.SDL_SetHint(key,value)
            flags=sdl.SDL_INIT_GAMECONTROLLER|sdl.SDL_INIT_EVENTS
            if sdl.SDL_InitSubSystem(flags)!=0:raise RuntimeError(sdl.SDL_GetError().decode())
            initialized=True
            deadline=time.monotonic()+4
            while time.monotonic()<deadline and not self._stop.is_set():
                sdl.SDL_GameControllerUpdate()
                for index in range(sdl.SDL_NumJoysticks()):
                    if sdl.SDL_JoystickGetDeviceVendor(index)!=0x057e or sdl.SDL_JoystickGetDeviceProduct(index)!=0x2009:continue
                    guid=sdl.SDL_JoystickGetDeviceGUID(index)
                    bus=int(guid.data[0])|(int(guid.data[1])<<8)
                    if bus!=3:continue # USB only; no Bluetooth or virtual XInput devices.
                    if not sdl.SDL_IsGameController(index):continue
                    controller=sdl.SDL_GameControllerOpen(index)
                    if controller:break
                if controller:break
                self._stop.wait(.05)
            if self._stop.is_set():return
            if not controller:raise RuntimeError('No wired Nintendo Switch Pro Controller found. Use a USB data cable and close Steam/controller mapping apps.')
            joystick=sdl.SDL_GameControllerGetJoystick(controller)
            instance=sdl.SDL_JoystickInstanceID(joystick)
            name=(sdl.SDL_GameControllerName(controller) or b'Pro Controller').decode(errors='replace')
            info={'productName':name,'vendorId':'057E','productId':'2009','transport':'wired SDL HIDAPI','controllerKind':'pro'}
            axes=[sdl.SDL_GameControllerGetAxis(controller,i) for i in range(6)]
            buttons=[bool(sdl.SDL_GameControllerGetButton(controller,i)) for i in range(21)]
            self._set_status(state='connected',stage='reading',message='Wired Pro Controller connected.',device=info)
            self._publish(axes,buttons,time.monotonic_ns()/1e6)
            event=sdl.SDL_Event();last_heartbeat=time.monotonic()
            while not self._stop.is_set():
                sdl.SDL_GameControllerUpdate()
                now_ms=time.monotonic_ns()/1e6;ticks=sdl.SDL_GetTicks()
                batch=ControllerEventBatch(axes,buttons,lambda a,b,t:self._publish(a,b,now_ms-((ticks-t)&0xffffffff)))
                while sdl.SDL_PollEvent(ctypes.byref(event)):
                    kind=event.type
                    if kind==sdl.SDL_CONTROLLERDEVICEREMOVED and event.cdevice.which==instance:raise RuntimeError('Pro Controller unplugged.')
                    if kind==sdl.SDL_CONTROLLERAXISMOTION and event.caxis.which==instance:
                        batch.update('axis',event.caxis.axis,event.caxis.value,event.caxis.timestamp)
                    elif kind in (sdl.SDL_CONTROLLERBUTTONDOWN,sdl.SDL_CONTROLLERBUTTONUP) and event.cbutton.which==instance:
                        batch.update('button',event.cbutton.button,event.cbutton.state,event.cbutton.timestamp)
                if batch.timestamp is not None:
                    batch.flush();last_heartbeat=time.monotonic()
                elif time.monotonic()-last_heartbeat>=.05:
                    self._publish(axes,buttons,now_ms);last_heartbeat=time.monotonic()
                if not sdl.SDL_GameControllerGetAttached(controller):raise RuntimeError('Pro Controller unplugged.')
                sdl.SDL_Delay(1)
        except Exception as error:
            if not self._stop.is_set():self._set_status(state='error',stage='wired Pro Controller',message=str(error))
        finally:
            if sdl and controller:sdl.SDL_GameControllerClose(controller)
            if sdl and initialized:sdl.SDL_QuitSubSystem(sdl.SDL_INIT_GAMECONTROLLER|sdl.SDL_INIT_EVENTS)
