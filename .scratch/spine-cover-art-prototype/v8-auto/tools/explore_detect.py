import cv2, numpy as np, os, json, time, sys
from rapidocr_onnxruntime import RapidOCR

ROOT='/mnt/ssd2/Projects/PocketLibrary/.scratch/spine-cover-art-prototype'
BOOKS={
 'hound': ROOT+'/reproducibility/book/cover.jpg',
 'rps': ROOT+'/v6/assets/modern/rps-cover.jpg',
 'harry-potter': ROOT+'/v7/assets/source/harry-potter.jpg',
 'hunger-games': ROOT+'/v7/assets/source/the-hunger-games.jpg',
}
os.makedirs('explore',exist_ok=True)
ocr=RapidOCR(det_model_path=None, det_limit_side_len=1600, det_limit_type='min', det_unclip_ratio=1.8, det_box_thresh=0.35)
for slug,p in BOOKS.items():
    img=cv2.imread(p); h,w=img.shape[:2]
    t=time.time(); res,_=ocr(p); dt=time.time()-t
    print(slug, (w,h), 'detect+rec', round(dt,2), 'n',len(res or []))
    vis=img.copy()
    for box,text,conf in (res or []):
        pts=np.array(box,np.int32); cv2.polylines(vis,[pts],True,(0,255,0),2)
    cv2.imwrite(f'explore/{slug}-det.jpg',vis)
    # detector only
    small=cv2.resize(img,(int(w*1.5),int(h*1.5)),interpolation=cv2.INTER_CUBIC)
    t=time.time(); boxes,el=ocr.text_detector(small); dt2=time.time()-t
    print('  detector-only 1.5x', round(dt2,2), 'n',len(boxes))
    vis2=small.copy()
    for b in boxes:
        pts=np.array(b,np.int32); cv2.polylines(vis2,[pts],True,(0,255,255),2)
    cv2.imwrite(f'explore/{slug}-dbnet.jpg',vis2)
