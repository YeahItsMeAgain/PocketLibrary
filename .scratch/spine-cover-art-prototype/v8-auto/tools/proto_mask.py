import cv2, numpy as np, os, math, json, time
from rapidocr_onnxruntime import RapidOCR

ROOT='/mnt/ssd2/Projects/PocketLibrary/.scratch/spine-cover-art-prototype'
BOOKS={
 'hound': ROOT+'/reproducibility/book/cover.jpg',
 'rps': ROOT+'/v6/assets/modern/rps-cover.jpg',
 'harry-potter': ROOT+'/v7/assets/source/harry-potter.jpg',
 'hunger-games': ROOT+'/v7/assets/source/the-hunger-games.jpg',
}

def order_pts(box):
    box=np.array(box,np.float32)
    s=box.sum(1); d=np.diff(box,axis=1).ravel()
    return np.array([box[np.argmin(s)],box[np.argmin(d)],box[np.argmax(s)],box[np.argmax(d)]],np.float32)

def angle_of(box):
    pts=order_pts(box)
    dx=pts[1][0]-pts[0][0]; dy=pts[1][1]-pts[0][1]
    return math.degrees(math.atan2(dy,dx))

def bbox_of(box):
    b=np.array(box); return b[:,0].min(),b[:,1].min(),b[:,0].max(),b[:,1].max()

def seg_line(img, box, scale=1.0):
    h,w=img.shape[:2]
    x0,y0,x1,y1=bbox_of(box); bw=x1-x0; bh=y1-y0
    ang=angle_of(box)
    horiz = abs(ang)<45
    if horiz:
        px,py=0.85*bh,0.22*bh
    else:
        px,py=0.22*bw,0.85*bw
    X0=max(0,int(x0-px)); Y0=max(0,int(y0-py)); X1=min(w,int(x1+px)); Y1=min(h,int(y1+py))
    roi=img[Y0:Y1,X0:X1]
    if roi.size==0: return np.zeros((h,w),np.uint8)
    # border estimate: strips along the long axis edges
    lab=cv2.cvtColor(roi,cv2.COLOR_BGR2LAB).astype(np.float32)
    if horiz:
        band=max(2,int(bh*0.18)); samples=np.concatenate([lab[:band].reshape(-1,3),lab[-band:].reshape(-1,3),lab[:, :max(2,int(bw*0.05))].reshape(-1,3),lab[:, -max(2,int(bw*0.05)):].reshape(-1,3)])
    else:
        band=max(2,int(bw*0.18)); samples=np.concatenate([lab[:, :band].reshape(-1,3),lab[:, -band:].reshape(-1,3),lab[:max(2,int(bh*0.05))].reshape(-1,3),lab[-max(2,int(bh*0.05)):].reshape(-1,3)])
    med=np.median(samples,0)
    dist=np.linalg.norm(lab-med,axis=2)
    # otsu on distance, but require min absolute distance
    d8=np.clip(dist/255*255,0,255).astype(np.uint8)
    t,_=cv2.threshold(d8,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    t=max(t,18.0)
    sel=(dist>t).astype(np.uint8)*255
    # remove tiny specks and components not near the detected box
    n,labc,stats,_=cv2.connectedComponentsWithStats(sel,8)
    keep=np.zeros_like(sel)
    bx0,by0=x0-X0,y0-Y0; bx1,by1=x1-X0,y1-Y0
    for i in range(1,n):
        x,y,ww,hh,area=stats[i]
        if area<12: continue
        # overlap with padded box
        ox=max(0,min(x+ww,bx1+0.4*bh)-max(x,bx0-0.4*bh)); oy=max(0,min(y+hh,by1+0.25*bh)-max(y,by0-0.25*bh))
        if ox*oy>0 or (x>=bx0-0.35*bh and x<=bx1+0.35*bh and y>=by0-0.3*bh and y<=by1+0.3*bh):
            keep[labc==i]=255
    m=np.zeros((h,w),np.uint8); m[Y0:Y1,X0:X1]=keep
    # union detected polygon
    cv2.fillPoly(m,[np.array(box,np.int32)],255)
    return m

def build(img):
    h,w=img.shape[:2]
    t=time.time()
    ocr=RapidOCR(det_model_path=None, det_limit_side_len=1600, det_limit_type='min', det_unclip_ratio=2.0, det_box_thresh=0.3, det_thresh=0.2)
    boxes,el=ocr.text_detector(img)
    dt=time.time()-t
    mask=np.zeros((h,w),np.uint8)
    hs=[]
    for b in boxes:
        x0,y0,x1,y1=bbox_of(b); hs.append(max(1,y1-y0) if abs(angle_of(b))<45 else max(1,x1-x0))
        mask|=seg_line(img,b)
    # group horizontal lines & bridge
    rects=[]
    for b in boxes:
        x0,y0,x1,y1=bbox_of(b); rects.append([x0,y0,x1,y1,angle_of(b)])
    used=[False]*len(rects)
    lines=[]
    for i,r in enumerate(rects):
        if used[i]: continue
        used[i]=True
        if abs(r[4])>=45: lines.append(r[:4]); continue
        cur=r[:4]
        changed=True
        while changed:
            changed=False
            for j,s in enumerate(rects):
                if used[j] or abs(s[4])>=45: continue
                yov=min(cur[3],s[3])-max(cur[1],s[1]); hh=min(cur[3]-cur[1],s[3]-s[1])
                if yov>0.55*hh and s[0]<=cur[2]+1.2*hh and s[2]>=cur[0]-1.2*hh:
                    cur=[min(cur[0],s[0]),min(cur[1],s[1]),max(cur[2],s[2]),max(cur[3],s[3])]
                    used[j]=True; changed=True
        lines.append(cur)
    for x0,y0,x1,y1 in lines:
        bh=y1-y0
        # bridge word gaps and cover likely missing edge glyph
        cv2.rectangle(mask,(int(max(0,x0-0.5*bh)),int(y0)),(int(min(w,x1+0.5*bh)),int(y1)),255,-1)
    # dilate proportional to line heights
    hmed=float(np.median(hs)) if hs else 8
    k=int(max(5,round(hmed*0.22)))
    if k%2==0:k+=1
    mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k)))
    return mask,boxes,dt

if __name__=='__main__':
    os.makedirs('explore',exist_ok=True)
    for slug,p in BOOKS.items():
        img=cv2.imread(p)
        mask,boxes,dt=build(img)
        vis=img.copy(); vis[mask>0]=(0.35*vis[mask>0]+0.65*np.array([0,0,255])).astype(np.uint8)
        cv2.imwrite(f'explore/{slug}-automask.jpg',vis)
        cv2.imwrite(f'explore/{slug}-mask.png',mask)
        print(slug, img.shape[:2], 'boxes',len(boxes),'coverage',round((mask>0).mean()*100,1),'det_s',round(dt,2))
