//! ONNX Runtime allows a single process-global environment. All sessions share
//! this one, which also keeps the Android `libonnxruntime.so` loaded once.

use ort::environment::Environment;
use std::sync::OnceLock;

pub fn shared() -> &'static Environment {
    static ENV: OnceLock<Environment> = OnceLock::new();
    ENV.get_or_init(|| {
        ort::init()
            .build()
            .expect("ONNX Runtime environment initialisation failed")
    })
}
