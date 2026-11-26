import cv2, numpy as np, os, math, time
from rapidocr_onnxruntime import RapidOCR
ROOT='/mnt/ssd2/Projects/PocketLibrary/.scratch/spine-cover-art-prototype'
BOOKS={'hound':ROOT+'/reproducibility/book/cover.jpg','rps':ROOT+'/v6/assets/modern/rps-cover.jpg','harry-potter':ROOT+'/v7/assets/source/harry-potter.jpg','hunger-games':ROOT+'/v7/assets/source/the-hunger-games.jpg'}
def pts_of(box):
    b=np.array(box,np.float32); s=b.sum(1); d=np.diff(b,axis=1).ravel()
    return np.array([b[np.argmin(s)],b[np.argmin(d)],b[np.argmax(s)],b[np.argmax(d)]],np.float32)
def angle_of(box):
    p=pts_of(box); return math.degrees(math.atan2(p[1][1]-p[0][1],p[1][0]-p[0][0]))
def bbox_of(box):
    b=np.array(box); return b[:,0].min(),b[:,1].min(),b[:,0].max(),b[:,1].max()
def seg_box(img,box,debug=False):
    h,w=img.shape[:2]; x0,y0,x1,y1=bbox_of(box); bw=max(1,x1-x0); bh=max(1,y1-y0)
    horiz=abs(angle_of(box))<45
    if horiz: px,py=0.35*bh,0.10*bh
    else: px,py=0.10*bw,0.35*bw
    X0=max(0,int(x0-px));Y0=max(0,int(y0-py));X1=min(w,int(x1+px));Y1=min(h,int(y1+py))
    roi=img[Y0:Y1,X0:X1]
    if roi.size==0: return np.zeros((h,w),np.uint8)
    lab=cv2.cvtColor(roi,cv2.COLOR_BGR2LAB).astype(np.float32)
    if horiz:
        bd=max(2,int(bh*0.18)); border=np.concatenate([lab[:bd].reshape(-1,3),lab[-bd:].reshape(-1,3)])
    else:
        bd=max(2,int(bw*0.18)); border=np.concatenate([lab[:,:bd].reshape(-1,3),lab[:,-bd:].reshape(-1,3)])
    bg=np.median(border,0)
    core=np.zeros(roi.shape[:2],np.uint8)
    poly=np.array([[x-X0,y-Y0] for x,y in box],np.int32); cv2.fillPoly(core,[poly],255)
    core_er=cv2.erode(core,np.ones((3,3),np.uint8)); cf=core_er.reshape(-1)>0
    pix=lab.reshape(-1,3); dbg=np.linalg.norm(pix-bg,axis=1)
    core_dist=dbg[cf]
    if len(core_dist)<20:
        m=np.zeros((h,w),np.uint8); m[Y0:Y1,X0:X1]=core; return m
    # text pixels = most distant quartile inside the polygon
    thr=np.percentile(core_dist,72)
    tp=pix[cf & (dbg>=thr)]
    text_color=np.median(tp,0)
    # refine: second pass keeps pixels near text colour
    dt=np.linalg.norm(pix-text_color,axis=1); dg=np.linalg.norm(pix-bg,axis=1)
    sel=((dt<58)&(dg>20)).reshape(roi.shape[:2]).astype(np.uint8)*255
    n,labc,stats,_=cv2.connectedComponentsWithStats(sel,8)
    keep=np.zeros_like(sel); core_d=cv2.dilate(core_er,np.ones((3,3),np.uint8))
    for i in range(1,n):
        x,y,ww,hh,area=stats[i]
        if area<8: continue
        keep[labc==i]=255
    # fallback: if too little found inside polygon, use polygon
    found=(keep>0).sum(); poly_area=max(1,int(core.sum()/255))
    if debug: print(' box',round(x0),round(y0),round(x1),round(y1),'bg',bg.round(0),'text',text_color.round(0),'thr',round(float(thr),1),'found/poly',round(found/poly_area,2))
    if found < 0.06*poly_area:
        keep=core.copy()
    m=np.zeros((h,w),np.uint8); m[Y0:Y1,X0:X1]=keep
    return m
def build(img,debug=False):
    h,w=img.shape[:2]
    ocr=RapidOCR(det_model_path=None,det_limit_side_len=1600,det_limit_type='min',det_unclip_ratio=1.9,det_box_thresh=0.28,det_thresh=0.18)
    t=time.time(); boxes,el=ocr.text_detector(img); dt=time.time()-t
    mask=np.zeros((h,w),np.uint8); hs=[]
    for b in boxes:
        x0,y0,x1,y1=bbox_of(b); bh=max(1,y1-y0); bw=max(1,x1-x0); hs.append(bh if abs(angle_of(b))<45 else bw)
        mask|=seg_box(img,b,debug)
    hmed=float(np.median(hs)) if hs else 8
    d=int(max(5,round(hmed*0.14))); d=d if d%2 else d+1
    mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(d,d)))
    return mask,boxes,dt
if __name__=='__main__':
    for slug,p in BOOKS.items():
        img=cv2.imread(p); mask,boxes,dt=build(img,debug=False)
        vis=img.copy(); vis[mask>0]=(0.4*vis[mask>0]+0.6*np.array([0,0,255])).astype(np.uint8)
        cv2.imwrite(f'explore/{slug}-automask7.jpg',vis); cv2.imwrite(f'explore/{slug}-mask7.png',mask)
        print(slug,img.shape[:2],'boxes',len(boxes),'coverage',round((mask>0).mean()*100,1),'det_s',round(dt,2))
