import cv2, numpy as np, os, math, time
from rapidocr_onnxruntime import RapidOCR
ROOT='/mnt/ssd2/Projects/PocketLibrary/.scratch/spine-cover-art-prototype'
BOOKS={'hound':ROOT+'/reproducibility/book/cover.jpg','rps':ROOT+'/v6/assets/modern/rps-cover.jpg','harry-potter':ROOT+'/v7/assets/source/harry-potter.jpg','hunger-games':ROOT+'/v7/assets/source/the-hunger-games.jpg'}
def angle_of(box):
    b=np.array(box,np.float32); s=b.sum(1); d=np.diff(b,axis=1).ravel()
    p=np.array([b[np.argmin(s)],b[np.argmin(d)],b[np.argmax(s)],b[np.argmax(d)]],np.float32)
    return math.degrees(math.atan2(p[1][1]-p[0][1],p[1][0]-p[0][0]))
def bbox_of(box):
    b=np.array(box); return b[:,0].min(),b[:,1].min(),b[:,0].max(),b[:,1].max()
def seg_box(img,box):
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
    thr=np.percentile(core_dist,72); tp=pix[cf & (dbg>=thr)]; text_color=np.median(tp,0)
    dt=np.linalg.norm(pix-text_color,axis=1); dg=np.linalg.norm(pix-bg,axis=1)
    sel=((dt<58)&(dg>20)).reshape(roi.shape[:2]).astype(np.uint8)*255
    find=(sel>0).sum(); poly_area=max(1,int(core.sum()/255))
    if find < 0.05*poly_area: sel=core.copy()
    m=np.zeros((h,w),np.uint8); m[Y0:Y1,X0:X1]=sel
    return m

def line_contrast(img,boxlist):
    h,w=img.shape[:2]; mask=np.zeros((h,w),np.uint8)
    lab=cv2.cvtColor(img,cv2.COLOR_BGR2LAB).astype(np.float32)
    rects=[]
    for b in boxlist:
        x0,y0,x1,y1=bbox_of(b); rects.append([x0,y0,x1,y1,angle_of(b)])
    used=[False]*len(rects); lines=[]
    for i,r in enumerate(rects):
        if used[i]: continue
        used[i]=True
        if abs(r[4])>=45: lines.append(r[:4]); continue
        cur=list(r[:4]); changed=True
        while changed:
            changed=False
            for j,s in enumerate(rects):
                if used[j] or abs(s[4])>=45: continue
                hh=min(cur[3]-cur[1],s[3]-s[1]); yov=min(cur[3],s[3])-max(cur[1],s[1])
                gap=max(s[0]-cur[2],cur[0]-s[2])
                if yov>0.55*hh and gap<1.2*hh:
                    cur=[min(cur[0],s[0]),min(cur[1],s[1]),max(cur[2],s[2]),max(cur[3],s[3])]
                    used[j]=True; changed=True
        lines.append(cur)
    for x0,y0,x1,y1 in lines:
        bh=max(1,y1-y0)
        X0=max(0,int(x0-0.10*bh)); X1=min(w,int(x1+0.10*bh)); Y0=max(0,int(y0-0.05*bh)); Y1=min(h,int(y1+0.05*bh))
        roi=lab[Y0:Y1,X0:X1]
        if roi.size==0: continue
        border=np.concatenate([roi[:max(2,int((Y1-Y0)*0.15))].reshape(-1,3),roi[-max(2,int((Y1-Y0)*0.15)):].reshape(-1,3)])
        bg=np.median(border,0); dg=np.linalg.norm(roi-bg,axis=2)
        sel=(dg>35).astype(np.uint8)*255
        mask[Y0:Y1,X0:X1]=np.maximum(mask[Y0:Y1,X0:X1],sel)
    return mask

def build(img):
    h,w=img.shape[:2]
    ocr=RapidOCR(det_model_path=None,det_limit_side_len=1600,det_limit_type='min',det_unclip_ratio=1.9,det_box_thresh=0.28,det_thresh=0.18)
    t=time.time(); boxes,el=ocr.text_detector(img); dt=time.time()-t
    mask=np.zeros((h,w),np.uint8); hs=[]
    for b in boxes:
        x0,y0,x1,y1=bbox_of(b); bh=max(1,y1-y0); bw=max(1,x1-x0); hs.append(bh if abs(angle_of(b))<45 else bw)
        mask|=seg_box(img,b)
    mask|=line_contrast(img,[b for b in boxes if abs(angle_of(b))<45])
    hmed=float(np.median(hs)) if hs else 8
    d=int(max(5,round(hmed*0.14))); d=d if d%2 else d+1
    mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(d,d)))
    return mask,boxes,dt
if __name__=='__main__':
    for slug,p in BOOKS.items():
        img=cv2.imread(p); mask,boxes,dt=build(img)
        vis=img.copy(); vis[mask>0]=(0.4*vis[mask>0]+0.6*np.array([0,0,255])).astype(np.uint8)
        cv2.imwrite(f'explore/{slug}-automask8.jpg',vis); cv2.imwrite(f'explore/{slug}-mask8.png',mask)
        print(slug,img.shape[:2],'boxes',len(boxes),'coverage',round((mask>0).mean()*100,1),'det_s',round(dt,2))
