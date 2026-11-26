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
def build(img):
    h,w=img.shape[:2]
    ocr=RapidOCR(det_model_path=None,det_limit_side_len=1600,det_limit_type='min',det_unclip_ratio=2.2,det_box_thresh=0.28,det_thresh=0.18)
    t=time.time(); boxes,el=ocr.text_detector(img); dt=time.time()-t
    mask=np.zeros((h,w),np.uint8); hs=[]
    for b in boxes:
        x0,y0,x1,y1=bbox_of(b); bh=max(1,y1-y0); bw=max(1,x1-x0)
        horiz=abs(angle_of(b))<45; hs.append(bh if horiz else bw)
        m=np.zeros((h,w),np.uint8); cv2.fillPoly(m,[np.array(b,np.int32)],255)
        # extend along text direction to complete glyphs
        if horiz:
            kx=int(round(bh*0.45)); ky=int(round(bh*0.18))
        else:
            kx=int(round(bw*0.18)); ky=int(round(bw*0.45))
        m=cv2.dilate(m,cv2.getStructuringElement(cv2.MORPH_RECT,(max(1,kx*2+1),max(1,ky*2+1))))
        mask|=m
    hmed=float(np.median(hs)) if hs else 8
    d=int(max(5,round(hmed*0.12))); d=d if d%2 else d+1
    mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(d,d)))
    return mask,boxes,dt
if __name__=='__main__':
    for slug,p in BOOKS.items():
        img=cv2.imread(p); mask,boxes,dt=build(img)
        vis=img.copy(); vis[mask>0]=(0.4*vis[mask>0]+0.6*np.array([0,0,255])).astype(np.uint8)
        cv2.imwrite(f'explore/{slug}-automask3.jpg',vis); cv2.imwrite(f'explore/{slug}-mask3.png',mask)
        print(slug,img.shape[:2],'boxes',len(boxes),'coverage',round((mask>0).mean()*100,1),'det_s',round(dt,2))
