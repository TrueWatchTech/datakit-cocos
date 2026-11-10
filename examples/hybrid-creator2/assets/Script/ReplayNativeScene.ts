import ReplayPrivacy, { ReplayPrivacyMode } from '../truewatch-cocos-sdk/ReplayPrivacy';
import { coverageTexturePixels } from '../acceptance-components/ReplayBasicCoverage';

const { ccclass } = cc._decorator;
const ORANGE=cc.color(248,164,44),CYAN=cc.color(40,210,220),PANEL=cc.color(27,39,64);
// Creator 2's bundled declarations omit the gfx/Model/Skeleton asset APIs and
// Light properties. Keep that legacy declaration boundary local to the fixture.
const engine=cc as any;

@ccclass('ReplayNativeScene')
export class ReplayNativeScene extends cc.Component {
  private assets:cc.Asset[]=[];
  private disposed=false;
  async initialize(exit:()=>void,track:(id:string,stage:string)=>void):Promise<void> {
    const effect=await new Promise<cc.EffectAsset>((resolve,reject)=>cc.resources.load('ReplayCoveragePhong',cc.EffectAsset,(e,a)=>e?reject(e):resolve(a)));
    if(!this.isValid||this.disposed)return;
    const white=this.frame(false),pattern=this.frame(true);
    this.label(this.node,'Replay Creator 2 mesh / light / 3D particles / skeleton · batch 15',0,282,930,40,23);
    this.label(this.node,'Actual Mesh and serialized two-joint assets; original installed Phong effect; bounded CPU particles.',0,242,930,30,14);
    const group=this.child(this.node,'Cases',0,0,960,430);
    const names=['MeshRenderer','Light','ParticleSystem3D','Skeleton Animation','Skinned Mesh Renderer'];
    const ys=[170,95,20,-55,-140],bodies:cc.Node[]=[],privacy:ReplayPrivacy[]=[],notes:cc.Label[]=[];
    names.forEach((name,i)=>{
      this.label(group,`M0${i+1} / ${name}`,-330,ys[i]!,255,50,16);
      for(const [suffix,x,y,w,h]of [['Top',0,32,358,3],['Bottom',0,-32,358,3],['Left',-179,0,3,64],['Right',179,0,3,64]]as Array<[string,number,number,number,number]>)this.panel(group,name+suffix,x,ys[i]!+y,w,h,cc.color(44,202,178),white);
      const body=this.child(group,name+'Container',0,ys[i]!,348,54);bodies.push(body);const p=body.addComponent(ReplayPrivacy);p.enabled=false;privacy.push(p);notes.push(this.label(group,'',330,ys[i]!,245,50,13));
    });
    const unlit=(color:cc.Color)=>{const m=cc.Material.createWithBuiltin('unlit');m.define('USE_DIFFUSE_TEXTURE',false);m.setProperty('diffuseColor',color);this.assets.push(m);return m;};
    const flat=this.mesh(false),skinned=this.mesh(true);
    const staticNode=this.child(bodies[0]!,'ActualMesh',0,0,190,44);staticNode.is3DNode=true;staticNode.setPosition(0,0,5);
    const mesh=staticNode.addComponent(cc.MeshRenderer);mesh.mesh=flat;mesh.enableAutoBatch=false;mesh.setMaterial(0,unlit(ORANGE));staticNode.active=true;

    const receiverNode=this.child(bodies[1]!,'PhongReceiver',0,0,190,44);receiverNode.is3DNode=true;receiverNode.setPosition(0,0,5);
    const receiver=receiverNode.addComponent(cc.MeshRenderer);receiver.mesh=flat;receiver.enableAutoBatch=false;
    // Phong color uniforms belong to pass 0. The shadow pass has no color properties;
    // Creator 2.4.9 requires an explicit pass index for this multi-pass material.
    const lit=cc.Material.create(effect);lit.define('USE_DIFFUSE_TEXTURE',false);lit.define('USE_SPECULAR_TEXTURE',false);lit.define('USE_EMISSIVE_TEXTURE',false);lit.setProperty('diffuseColor',cc.Color.WHITE,0);lit.setProperty('specularColor',cc.Color.BLACK,0);lit.setProperty('emissiveColor',cc.Color.BLACK,0);this.assets.push(lit);receiver.setMaterial(0,lit);receiverNode.active=true;
    const lightNode=this.child(bodies[1]!,'ActualLight',0,0,0,0);lightNode.is3DNode=true;lightNode.setPosition(0,0,120);const light=lightNode.addComponent(cc.Light) as any;light.type=engine.Light.Type.DIRECTIONAL;light.intensity=1;

    const particleNode=this.child(bodies[2]!,'Actual3DParticles',0,0,1,1);particleNode.is3DNode=true;particleNode.setPosition(0,0,5);particleNode.active=false;
    const particles=particleNode.addComponent(cc.ParticleSystem3D) as cc.ParticleSystem3D&{getParticleCount:()=>number};particles.playOnAwake=false;particles.capacity=32;particles.startLifetime.constant=100;particles.startSpeed.constant=0;particles.gravityModifier.constant=0;particles.startSize.constant=14;particles.rateOverTime.constant=40;particles.shapeModule.enable=true;particles.shapeModule.radius=12;
    const particleMat=cc.Material.createWithBuiltin('3d-particle',1);particleMat.setProperty('mainTexture',white.getTexture());particleMat.setProperty('tintColor',cc.Color.WHITE);this.assets.push(particleMat);particles.setMaterial(0,particleMat);particleNode.active=true;
    const pulse=(color:cc.Color)=>{particles.stop();particles.clear();particles.startColor.color=color;particles.play();this.scheduleOnce(()=>{if(!this.disposed&&this.isValid){particles.pause();notes[2]!.string=`particles:${particles.getParticleCount()}\npaused bounded CPU pulse`;}},.4);};

    const rig=(parent:cc.Node,name:string)=>{
      const root=this.child(parent,name,0,0,200,48);root.is3DNode=true;root.setPosition(0,0,5);
      const left=this.child(root,'LeftBone',0,0,0,0),right=this.child(root,'RightBone',0,0,0,0);left.is3DNode=right.is3DNode=true;
      const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
      // Native cc.deserialize accepts packed build data, not raw editor JSON.
      // Hydrate genuine asset instances using their loader fields and onLoad.
      const model=new engine.Model();model.name=name+'Model';model.nodes.push(
        {name:'Rig',path:'',position:[0,0,0],scale:[1,1,1],quat:[0,0,0,1],children:[1,2]},
        {name:'LeftBone',path:'LeftBone',position:[0,0,0],scale:[1,1,1],quat:[0,0,0,1],children:[],bindpose:{0:identity}},
        {name:'RightBone',path:'RightBone',position:[0,0,0],scale:[1,1,1],quat:[0,0,0,1],children:[],bindpose:{0:identity}},
      );model.onLoad();
      const skeleton=new engine.Skeleton();skeleton.name=name+'Skeleton';skeleton._jointIndices=[1,2];skeleton._skinIndex=0;skeleton._model=model;skeleton.onLoad();this.assets.push(skeleton,model);
      const node=this.child(root,'ActualSkinnedMesh',0,0,190,44);node.is3DNode=true;
      const renderer=node.addComponent(cc.SkinnedMeshRenderer);renderer.mesh=skinned;renderer.rootBone=root;renderer.skeleton=skeleton;renderer.setMaterial(0,unlit(ORANGE));
      return {root,left,right,model,skeleton,renderer};
    };
    const animated=rig(bodies[3]!,'AnimatedRig');
    const animation=animated.root.addComponent(cc.SkeletonAnimation) as cc.SkeletonAnimation&{model:any};animation.model=animated.model;
    const clip=new cc.SkeletonAnimationClip() as cc.SkeletonAnimationClip&{_nativeAsset:ArrayBuffer;_duration:number;description:object};clip.name='BonePose';clip._duration=1;clip.sample=30;clip.description={RightBone:{position:{offset:0,frameCount:2}}};
    clip._nativeAsset=new Float32Array([0,0,-8,0,1,0,8,0]).buffer;this.assets.push(clip);animation.addClip(clip);animation.defaultClip=clip;
    animated.root.active=true;animation.play('BonePose');animation.pause();
    const manual=rig(bodies[4]!,'ManualRig');manual.root.active=true;

    let variant=false,lightOn=true,moved=false,visible=true,lastVariant:boolean|undefined;
    let mode:'default'|'mask'|'hide'='default';const status=this.label(this.node,'',0,-216,930,22,13);
    const apply=(stage:string)=>{
      group.setPosition(moved?28:0,moved?-8:0);group.setScale(moved?.85:1,moved?.85:1,1);
      bodies.forEach((n,i)=>{n.active=visible;privacy[i]!.mode=mode==='hide'?ReplayPrivacyMode.Hide:ReplayPrivacyMode.Mask;privacy[i]!.enabled=mode!=='default';});
      staticNode.setScale(variant?.85:1,variant?1.15:1,1);mesh.getMaterial(0).setProperty('diffuseColor',variant?CYAN:ORANGE);
      lightNode.active=visible;light.intensity=lightOn?1:0;light.color=variant?CYAN:ORANGE;
      if(lastVariant!==variant){lastVariant=variant;pulse(variant?CYAN:ORANGE);}
      animation.setCurrentTime(variant?.9:.1,'BonePose');animation.sample('BonePose');animated.renderer.getMaterial(0).setProperty('diffuseColor',variant?CYAN:ORANGE);
      manual.left.setPosition(0,variant?-5:5,0);manual.right.setPosition(0,variant?8:-8,0);manual.renderer.getMaterial(0).setProperty('diffuseColor',variant?ORANGE:CYAN);
      notes[0]!.string=`actual 8-vertex Mesh\nscale:${staticNode.scaleX.toFixed(2)}`;
      notes[1]!.string=`directional intensity:${light.intensity}\n${variant?'cyan':'orange'} / Phong receiver`;
      notes[3]!.string=`actual SkeletonAnimation\n2 bones / sample:${variant?.9:.1}`;
      notes[4]!.string=`rightBone.y:${manual.right.y}\nactual weighted mesh`;
      status.string=`${stage} | variant:${+variant} light:${lightOn} visible:${visible} privacy:${mode}`;track('page',stage);
    };
    const commands:Array<[string,()=>void]>=[
      ['Change five cases',()=>{variant=!variant;apply('changed');}],
      ['Light intensity 1 / 0',()=>{lightOn=!lightOn;apply(lightOn?'light-on':'light-off');}],
      ['Replay bounded CPU pulse',()=>{pulse(variant?CYAN:ORANGE);apply('particle-pulse');}],
      ['Move + scale',()=>{moved=!moved;apply('transformed');}],
      ['Hide / show',()=>{visible=!visible;apply(visible?'shown':'hidden');}],
      ['Privacy default / mask / hide',()=>{mode=mode==='default'?'mask':mode==='mask'?'hide':'default';apply('privacy-'+mode);}],
      ['Reset',()=>{variant=false;lightOn=true;moved=false;visible=true;mode='default';apply('reset');}],
      ['Back',()=>{if(!this.disposed){this.disposed=true;exit();}}],
    ];
    commands.forEach(([caption,click],i)=>{const b=this.panel(this.node,'Command'+i,-345+i%4*230,i<4?-245:-295,218,38,PANEL,white);b.addComponent(cc.Button);b.on('click',()=>{if(!this.disposed)click();});this.label(b,caption,0,0,212,34,12);});apply('entered');
    this.scheduleOnce(()=>console.log('[ReplayNativeScene] diagnostic',JSON.stringify({joints:animated.skeleton.jointPaths,bones:[animated.right.y,manual.right.y],meshSubmeshes:flat.subMeshes.length,skinnedSubmeshes:skinned.subMeshes.length,particleCount:particles.getParticleCount(),lightEnabled:light.enabledInHierarchy})),1);
  }
  private mesh(skin:boolean):cc.Mesh {
    const gfx=engine.gfx,attrs=[{name:gfx.ATTR_POSITION,type:gfx.ATTR_TYPE_FLOAT32,num:3},{name:gfx.ATTR_NORMAL,type:gfx.ATTR_TYPE_FLOAT32,num:3},{name:gfx.ATTR_UV0,type:gfx.ATTR_TYPE_FLOAT32,num:2}];
    if(skin)attrs.push({name:gfx.ATTR_JOINTS,type:gfx.ATTR_TYPE_FLOAT32,num:4},{name:gfx.ATTR_WEIGHTS,type:gfx.ATTR_TYPE_FLOAT32,num:4});
    const m=new cc.Mesh();m.init(new gfx.VertexFormat(attrs),8,false);const positions:number[]=[],normals:number[]=[],uvs:number[]=[],joints:number[]=[],weights:number[]=[],indices:number[]=[];
    for(let b=0;b<2;b++){const x0=b?10:-90,x1=b?90:-10;positions.push(x0,-12,0,x1,-12,0,x1,12,0,x0,12,0);uvs.push(0,0,1,0,1,1,0,1);for(let i=0;i<4;i++){normals.push(0,0,1);joints.push(b,0,0,0);weights.push(1,0,0,0);}indices.push(b*4,b*4+1,b*4+2,b*4,b*4+2,b*4+3);}
    m.setVertices(gfx.ATTR_POSITION,new Float32Array(positions));m.setVertices(gfx.ATTR_NORMAL,new Float32Array(normals));m.setVertices(gfx.ATTR_UV0,new Float32Array(uvs));if(skin){m.setVertices(gfx.ATTR_JOINTS,new Float32Array(joints));m.setVertices(gfx.ATTR_WEIGHTS,new Float32Array(weights));}m.setIndices(indices);m.setBoundingBox(cc.v3(-100,-24,0),cc.v3(100,24,0));this.assets.push(m);return m;
  }
  private frame(pattern:boolean):cc.SpriteFrame {const t=new cc.Texture2D();t.initWithData(coverageTexturePixels(pattern),cc.Texture2D.PixelFormat.RGBA8888,32,32);const f=new cc.SpriteFrame(t);this.assets.push(f,t);return f;}
  private child(parent:cc.Node,name:string,x:number,y:number,w:number,h:number):cc.Node {const n=new cc.Node(name);n.setContentSize(w,h);n.setPosition(x,y);parent.addChild(n);return n;}
  private panel(parent:cc.Node,name:string,x:number,y:number,w:number,h:number,color:cc.Color,frame:cc.SpriteFrame):cc.Node {const n=this.child(parent,name,x,y,w,h);n.color=color;const s=n.addComponent(cc.Sprite);s.sizeMode=cc.Sprite.SizeMode.CUSTOM;s.spriteFrame=frame;return n;}
  private label(parent:cc.Node,text:string,x:number,y:number,w:number,h:number,size:number):cc.Label {const n=this.child(parent,'Label',x,y,w,h);const l=n.addComponent(cc.Label);l.overflow=cc.Label.Overflow.CLAMP;n.setContentSize(w,h);l.string=text;l.fontSize=size;l.lineHeight=20;n.color=cc.color(239,244,255);l.horizontalAlign=cc.Label.HorizontalAlign.CENTER;l.verticalAlign=cc.Label.VerticalAlign.CENTER;return l;}
  onDestroy():void {this.disposed=true;this.unscheduleAllCallbacks();this.assets.forEach(x=>x.destroy());}
}
