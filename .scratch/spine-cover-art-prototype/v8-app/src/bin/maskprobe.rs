use anyhow::Result;
use image::GrayImage;
use v8_app::detect::Detector;
use v8_app::mask;
fn main() -> Result<()> {
    let img_path = std::env::args().nth(1).unwrap_or("../v6/assets/modern/rps-cover.jpg".into());
    let img = image::open(&img_path)?.to_rgb8();
    let mut det = Detector::new("models/det.onnx", 1600, "min")?;
    if std::env::args().nth(2).as_deref()==Some("loose") { det.box_thresh=0.05; det.thresh=0.10; }
    let resized = det.preprocess(&img);
    resized.save("/tmp/opencode/rps_resized.png")?;
    let (prob, pw, ph) = det.run_map(&resized)?;
    let mut pm = image::GrayImage::new(pw as u32, ph as u32);
    for y in 0..ph { for x in 0..pw { pm.put_pixel(x as u32, y as u32, image::Luma([(prob[y*pw+x]*255.0).clamp(0.0,255.0) as u8])); } }
    pm.save("/tmp/opencode/rps_prob.png")?;
    let (boxes, _) = det.detect(&img)?;
    let (w,h)=img.dimensions();
    let mut seg = vec![0u8; (w*h) as usize];
    for b in &boxes {
        let m = mask::seg_box(&img, b);
        for i in 0..seg.len() { if m[i]>0 { seg[i]=255; } }
    }
    let horiz: Vec<_> = boxes.iter().filter(|b| b.angle().abs()<45.0).collect();
    let line = mask::line_colour_mask(&img, &horiz);
    let mut both=vec![0u8;(w*h) as usize];
    for i in 0..both.len(){both[i]=seg[i].max(line[i]);}
    GrayImage::from_raw(w,h,seg).unwrap().save("/tmp/opencode/rps_seg.png")?;
    GrayImage::from_raw(w,h,line).unwrap().save("/tmp/opencode/rps_line.png")?;
    GrayImage::from_raw(w,h,both).unwrap().save("/tmp/opencode/rps_both.png")?;
    for (i,b) in boxes.iter().enumerate(){let (x0,y0,x1,y1)=b.bbox(); println!("{i:2} bbox=({x0:.0},{y0:.0},{x1:.0},{y1:.0}) ang={:.1} score={:.2}",b.angle(),b.score);}
    println!("boxes {}",boxes.len());
    Ok(())
}
