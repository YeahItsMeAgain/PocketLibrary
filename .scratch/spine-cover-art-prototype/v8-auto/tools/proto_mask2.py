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

def seg_box(img,box):
    h,w=img.shape[:2]; x0,y0,x1,y1=bbox_of(box); bw=max(1,x1-x0); bh=max(1,y1-y0)
    horiz=abs(angle_of(box))<45
    if horiz: px,py=0.75*bh,0.15*bh
    else: px,py=0.15*bw,0.75*bw
    X0=max(0,int(x0-px));Y0=max(0,int(y0-py));X1=min(w,int(x1+px));Y1=min(h,int(y1+py))
    roi=img[Y0:Y1,X0:X1]
    if roi.size==0: return np.zeros((h,w),np.uint8)
    lab=cv2.cvtColor(roi,cv2.COLOR_BGR2LAB).astype(np.float32)
    zeros=np.zeros((h,w),np.uint8)
    # border median color
    if horiz:
        bd=max(2,int(bh*0.2)); border=np.concatenate([lab[:bd].reshape(-1,3),lab[-bd:].reshape(-1,3)])
    else:
        bd=max(2,int(bw*0.2)); border=np.concatenate([lab[:,:bd].reshape(-1,3),lab[:,-bd:].reshape(-1,3)])
    bg=np.median(border,0)
    # core mask = polygon, eroded 10%
    core=np.zeros(roi.shape[:2],np.uint8)
    poly=np.array([[x-X0,y-Y0] for x,y in box],np.int32); cv2.fillPoly(core,[poly],255)
    core_er=cv2.erode(core,np.ones((3,3),np.uint8))
    pix=lab.reshape(-1,3)
    # sample for kmeans
    step=max(1,int(np.sqrt(len(pix)/12000)))
    samp=pix[::step]
    K=4
    crit=(cv2.TERM_CRITERIA_EPS+cv2.TERM_CRITERIA_MAX_ITER,30,0.5)
    _,_,centers=cv2.kmeans(samp,K,None,crit,2,cv2.KMEANS_PP_CENTERS)
    centers=centers.reshape(-1,3)
    d=np.linalg.norm(pix[:,None,:]-centers[None,:,:],axis=2)
    lbl=d.argmin(1).reshape(roi.shape[:2])
    core_flat=core_er.reshape(-1)>0
    core_total=max(1,core_flat.sum())
    dist_bg=np.linalg.norm(centers-bg,axis=1)
    scores=[]
    for k in range(K):
        n_core=int(((lbl.reshape(-1)==k)&core_flat).sum())
        scores.append((n_core/core_total,k,dist_bg[k]))
    scores.sort(reverse=True)
    best=scores[0]
    chosen=[]
    for frac,k,db in scores:
        if frac>0.12 and frac>best[0]*0.35 and db>14: chosen.append(k)
    if not chosen or best[0]<0.18:
        return cv2.copyMakeBorder if False else (lambda m: (m.__setitem__((slice(Y0,Y1),slice(X0,X1)),core), m)[1])(zeros)
    sel=np.isin(lbl,chosen).astype(np.uint8)*255
    # keep components touching core
    n,labc,stats,_=cv2.connectedComponentsWithStats(sel,8)
    keep=np.zeros_like(sel); core_d=cv2.dilate(core_er,np.ones((5,5),np.uint8))
    for i in range(1,n):
        x,y,ww,hh,area=stats[i]
        if area<10: continue
        comp=(labc==i).astype(np.uint8)
        if (comp & core_d).sum()>0 or (x>=x0-X0-0.3*bh and x+ww<=x1-X0+0.3*bh and y>=y0-Y0-0.3*bh and y+hh<=y1-Y0+0.3*bh):
            keep[labc==i]=255
    m=zeros.copy(); m[Y0:Y1,X0:X1]=keep
    cv2.fillPoly(m,[poly],255)
    return m

def build(img):
    h,w=img.shape[:2]; t=time.time()
    ocr=RapidOCR(det_model_path=None,det_limit_side_len=1600,det_limit_type='min',det_unclip_ratio=1.8,det_box_thresh=0.3,det_thresh=0.2)
    boxes,el=ocr.text_detector(img); dt=time.time()-t
    mask=np.zeros((h,w),np.uint8); hs=[]
    for b in boxes:
        x0,y0,x1,y1=bbox_of(b); bh=max(1,y1-y0); bw=max(1,x1-x0)
        hs.append(bh if abs(angle_of(b))<45 else bw)
        mask|=seg_box(img,b)
    # small horizontal closing to bridge glyph gaps within boxes
    hmed=float(np.median(hs)) if hs else 8
    k=int(max(3,round(hmed*0.18))); k=k if k%2 else k+1
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_RECT,(k,max(3,int(k*0.35)))))
    d=int(max(5,round(hmed*0.16))); d=d if d%2 else d+1
    mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(d,d)))
    return mask,boxes,dt

if __name__=='__main__':
    os.makedirs('explore',exist_ok=True)
    for slug,p in BOOKS.items():
        img=cv2.imread(p); mask,boxes,dt=build(img)
        vis=img.copy(); vis[mask>0]=(0.35*vis[mask>0]+0.65*np.array([0,0,255])).astype(np.uint8)
        cv2.imwrite(f'explore/{slug}-automask2.jpg',vis); cv2.imwrite(f'explore/{slug}-mask2.png',mask)
        print(slug,img.shape[:2],'boxes',len(boxes),'coverage',round((mask>0).mean()*100,1),'det_s',round(dt,2))
