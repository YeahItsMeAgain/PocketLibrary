use anyhow::Result;
use ort::session::Session;
use ort::value::Tensor;

fn main() -> Result<()> {
    let model = std::env::args().nth(1).unwrap_or_else(|| "models/det.onnx".into());
    println!("loading {model}");
    let env = ort::init().build()?;
    let mut session = Session::builder(&env)?.commit_from_file(&model)?;
    println!("inputs:");
    for i in session.inputs() {
        println!("  {} {:?}", i.name(), i.dtype());
    }
    println!("outputs:");
    for o in session.outputs() {
        println!("  {} {:?}", o.name(), o.dtype());
    }
    let shape = vec![1usize, 3, 64, 64];
    let data = vec![0.0f32; 3 * 64 * 64];
    let tensor = Tensor::<f32>::from_array((shape, data))?;
    let t = std::time::Instant::now();
    let outputs = session.run(ort::inputs![tensor])?;
    println!("ran in {:?}", t.elapsed());
    for (k, v) in outputs.iter() {
        let (shape, _) = v.try_extract_tensor::<f32>()?;
        println!("out {k} shape {:?}", shape);
    }
    Ok(())
}
