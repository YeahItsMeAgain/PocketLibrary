import cv2, numpy as np, sys, os, time, torch
sys.path.insert(0,'tools')
import proto_mask6 as pm
_orig=torch.jit.load
torch.jit.load=lambda p,*a,**k:_orig(p,map_location='cpu',*a,**k)
from simple_lama_inpainting import SimpleLama

def working_size(h,w,maxside=720):
    s=min(1.0,maxside/max(h,w))
    return int(round(w*s)),int(round(h*s))

def flat_fill(img,mask):
    out=img.copy(); lab=cv2.cvtColor(img,cv2.COLOR_BGR2LAB)
    n,labc,stats,_=cv2.connectedComponentsWithStats((mask>127).astype(np.uint8),8)
    flat=np.zeros_like(mask)
    for i in range(1,n):
        x,y,ww,hh,area=stats[i]
        if area<8: continue
        comp=(labc==i).astype(np.uint8)
        ring=(cv2.dilate(comp,np.ones((9,9),np.uint8))>0)&(comp==0)
        if ring.sum()<10: continue
        vals=lab[ring]
        if vals[:,0].std()<8 and np.abs(vals[:,1:].astype(float)-128).std()<8:
            col=np.median(vals,0).astype(np.uint8)
            out[comp>0]=cv2.cvtColor(col.reshape(1,1,3),cv2.COLOR_LAB2BGR).reshape(3)
            flat[comp>0]=255
    return out,flat

lama=SimpleLama(device='cpu')
for slug,p in [('rps','/mnt/ssd2/Projects/PocketLibrary/.scratch/spine-cover-art-prototype/v6/assets/modern/rps-cover.jpg'),('harry-potter','/mnt/ssd2/Projects/PocketLibrary/.scratch/spine-cover-art-prototype/v7/assets/source/harry-potter.jpg')]:
    img=cv2.imread(p); h,w=img.shape[:2]
    mask,boxes,dt=pm.build(img)
    W,H=working_size(h,w); small=cv2.resize(img,(W,H),interpolation=cv2.INTER_AREA)
    sm=cv2.resize(mask,(W,H),interpolation=cv2.INTER_AREA); sm=(sm>90).astype(np.uint8)*255; sm=cv2.dilate(sm,np.ones((3,3),np.uint8))
    t=time.time(); flat_img,flat=flat_fill(small,sm); print(slug,'flat fill',round(time.time()-t,2),'flat%',round((flat>0).mean()*100,1))
    rem=sm.copy(); rem[flat>0]=0
    if rem.sum()>0:
        t=time.time(); out=lama(__import__('PIL').Image.fromarray(cv2.cvtColor(flat_img,cv2.COLOR_BGR2RGB)),__import__('PIL').Image.fromarray(rem)); art=cv2.cvtColor(np.array(out),cv2.COLOR_RGB2BGR)[:H,:W]; print(slug,'lama',round(time.time()-t,1))
        # composite lama only in mask
        comp=flat_img.copy(); m3=rem>0; comp[m3]=art[m3]
    else: comp=flat_img
    cv2.imwrite(f'explore/{slug}-art6.jpg',comp)
    cv2.imwrite(f'explore/{slug}-mask6w.png',sm)
