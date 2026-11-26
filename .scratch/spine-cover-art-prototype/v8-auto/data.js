window.PocketV8 = {
  "ready": true,
  "summary": {
    "generated": "2026-11-26T17:58:41.338714+00:00",
    "studies": 5,
    "pass": 4,
    "review": 1,
    "fallback": 0,
    "manual_intervention": 0,
    "books": [
      {
        "slug": "hound",
        "title": "The Hound of the Baskervilles",
        "route": "text-free crop",
        "verdict": "pass",
        "mask_coverage_pct": 7.65,
        "spine_residual_ocr": 0,
        "crop_residual_ocr": 0,
        "spine_luma_std": 56.29,
        "spine_edge_density": 0.0863,
        "palette_corr": 0.75,
        "seam_ratio": 1.25,
        "runtime_s": 10.26,
        "reasons": [
          "zero mask coverage, no residual OCR, structure at spine scale"
        ]
      },
      {
        "slug": "rps",
        "title": "Rock Paper Scissors",
        "route": "inpaint",
        "verdict": "review",
        "mask_coverage_pct": 40.05,
        "spine_residual_ocr": 0,
        "crop_residual_ocr": 0,
        "spine_luma_std": 45.44,
        "spine_edge_density": 0.2084,
        "palette_corr": 0.875,
        "seam_ratio": 0.76,
        "runtime_s": 29.42,
        "reasons": [
          "40-55% of the cover was reconstructed"
        ]
      },
      {
        "slug": "harry-potter",
        "title": "Harry Potter and the Philosopher's Stone",
        "route": "text-free crop",
        "verdict": "pass",
        "mask_coverage_pct": 37.4,
        "spine_residual_ocr": 0,
        "crop_residual_ocr": 0,
        "spine_luma_std": 45.01,
        "spine_edge_density": 0.2388,
        "palette_corr": 0.057,
        "seam_ratio": 0.79,
        "runtime_s": 28.38,
        "reasons": [
          "zero mask coverage, no residual OCR, structure at spine scale"
        ]
      },
      {
        "slug": "hunger-games",
        "title": "The Hunger Games",
        "route": "text-free crop",
        "verdict": "pass",
        "mask_coverage_pct": 26.02,
        "spine_residual_ocr": 0,
        "crop_residual_ocr": 0,
        "spine_luma_std": 54.35,
        "spine_edge_density": 0.116,
        "palette_corr": 0.971,
        "seam_ratio": 1.17,
        "runtime_s": 23.93,
        "reasons": [
          "zero mask coverage, no residual OCR, structure at spine scale"
        ]
      },
      {
        "slug": "whisper-man",
        "title": "The Whisper Man",
        "route": "text-free crop",
        "verdict": "pass",
        "mask_coverage_pct": 14.07,
        "spine_residual_ocr": 0,
        "crop_residual_ocr": 0,
        "spine_luma_std": 40.87,
        "spine_edge_density": 0.2041,
        "palette_corr": 0.457,
        "seam_ratio": 1.21,
        "runtime_s": 31.94,
        "reasons": [
          "zero mask coverage, no residual OCR, structure at spine scale"
        ]
      }
    ]
  },
  "books": [
    {
      "slug": "hound",
      "book": {
        "title": "The Hound of the Baskervilles",
        "author": "Arthur Conan Doyle",
        "pages": 170,
        "cover": "../reproducibility/book/cover.jpg"
      },
      "generated": "2026-11-26T17:40:09.768650+00:00",
      "route": "text-free crop",
      "verdict": "pass",
      "decision_reasons": [
        "zero mask coverage, no residual OCR, structure at spine scale"
      ],
      "manual_intervention": 0,
      "model": {
        "text_detector": "PP-OCRv3 DBNet (rapidocr_onnxruntime, ONNX, CPU)",
        "text_remover": "LaMa big-lama (simple-lama-inpainting, CPU) + sampled flat fill",
        "ocr_qa": "PP-OCRv3 recogniser",
        "crop_search": "integral-image spine-aspect scan + residual OCR",
        "generative_diffusion": "not used"
      },
      "runtime_s": {
        "detection": 3.46,
        "mask_total": 3.59,
        "inpaint_flat": 0.03,
        "inpaint_lama": 0.0,
        "crop_search": 0.57,
        "total": 10.26
      },
      "source": {
        "width": 1400,
        "height": 2100
      },
      "working": {
        "width": 480,
        "height": 720,
        "scale": 0.3429
      },
      "mask": {
        "coverage_pct": 7.65,
        "components": 4,
        "detection_boxes": 3,
        "flat_fill_pct": 8.3
      },
      "detected_text": [
        {
          "text": "THE HOUND OF",
          "conf": 0.857,
          "box": [
            [
              306.0,
              1696.0
            ],
            [
              1098.0,
              1696.0
            ],
            [
              1098.0,
              1778.0
            ],
            [
              306.0,
              1778.0
            ]
          ]
        },
        {
          "text": "THE BASKERVILLES",
          "conf": 0.902,
          "box": [
            [
              205.0,
              1797.0
            ],
            [
              1195.0,
              1797.0
            ],
            [
              1195.0,
              1879.0
            ],
            [
              205.0,
              1879.0
            ]
          ]
        },
        {
          "text": "ARTHUR CONAN DOYLE",
          "conf": 0.88,
          "box": [
            [
              369.0,
              1933.0
            ],
            [
              1034.0,
              1933.0
            ],
            [
              1034.0,
              1981.0
            ],
            [
              369.0,
              1981.0
            ]
          ]
        }
      ],
      "crop_options": {
        "text_free": {
          "box": [
            0,
            191,
            93,
            421
          ],
          "coverage": 0.0,
          "luma_std": 56.27,
          "edge_density": 0.0596,
          "non_dark": 0.89,
          "salience": 8.8,
          "score": 2.9673,
          "ocr": []
        },
        "text_free_ocr_checks": [
          {
            "box": [
              0,
              191,
              93,
              421
            ],
            "ocr": []
          }
        ],
        "inpaint_visual": {
          "box": [
            0,
            194,
            87,
            396
          ],
          "coverage": 0.0,
          "luma_std": 51.54,
          "edge_density": 0.0627,
          "non_dark": 0.929,
          "salience": 8.87,
          "score": 2.9643
        }
      },
      "qa": {
        "chosen": {
          "mask_coverage_pct": 8.25,
          "crop_mask_coverage_pct": 0.0,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 56.29,
            "luma_p5": 14.0,
            "luma_p95": 194.0,
            "non_dark_pct": 88.9,
            "edge_density": 0.0863,
            "laplacian_var": 641.3,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.75,
          "seam": {
            "seam_ratio": 1.25,
            "inside_vs_ring_delta_e": 2.0,
            "inside_ring_std_ratio": 0.22,
            "boundary_px": 3738
          },
          "score": 2.9673
        },
        "text_free": {
          "mask_coverage_pct": 8.25,
          "crop_mask_coverage_pct": 0.0,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 56.29,
            "luma_p5": 14.0,
            "luma_p95": 194.0,
            "non_dark_pct": 88.9,
            "edge_density": 0.0863,
            "laplacian_var": 641.3,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.75,
          "seam": {
            "seam_ratio": 1.25,
            "inside_vs_ring_delta_e": 2.0,
            "inside_ring_std_ratio": 0.22,
            "boundary_px": 3738
          },
          "score": 2.9673
        },
        "inpaint": {
          "mask_coverage_pct": 8.25,
          "crop_mask_coverage_pct": 0.0,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 51.55,
            "luma_p5": 16.0,
            "luma_p95": 193.0,
            "non_dark_pct": 92.8,
            "edge_density": 0.0904,
            "laplacian_var": 625.5,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.748,
          "seam": {
            "seam_ratio": 1.25,
            "inside_vs_ring_delta_e": 2.0,
            "inside_ring_std_ratio": 0.22,
            "boundary_px": 3738
          },
          "score": 2.9643
        }
      },
      "final": {
        "route": "text-free crop",
        "verdict": "pass",
        "spine": "assets/hound/spine.jpg",
        "spine_2x": "assets/hound/spine-2x.jpg",
        "fallback_spine": "assets/hound/fallback-spine.jpg",
        "crop_box_work": [
          0,
          191,
          93,
          421
        ],
        "mask_coverage_in_crop_pct": 0.0
      },
      "label": "The Hound of the Baskervilles",
      "role": "Random reproducibility book"
    },
    {
      "slug": "rps",
      "book": {
        "title": "Rock Paper Scissors",
        "author": "Alice Feeney",
        "pages": 320,
        "cover": "../v6/assets/modern/rps-cover.jpg"
      },
      "generated": "2026-11-26T17:40:41.864148+00:00",
      "route": "inpaint",
      "verdict": "review",
      "decision_reasons": [
        "40-55% of the cover was reconstructed"
      ],
      "manual_intervention": 0,
      "model": {
        "text_detector": "PP-OCRv3 DBNet (rapidocr_onnxruntime, ONNX, CPU)",
        "text_remover": "LaMa big-lama (simple-lama-inpainting, CPU) + sampled flat fill",
        "ocr_qa": "PP-OCRv3 recogniser",
        "crop_search": "integral-image spine-aspect scan + residual OCR",
        "generative_diffusion": "not used"
      },
      "runtime_s": {
        "detection": 3.36,
        "mask_total": 3.76,
        "inpaint_flat": 0.03,
        "inpaint_lama": 19.21,
        "crop_search": 0.14,
        "total": 29.42
      },
      "source": {
        "width": 1303,
        "height": 2000
      },
      "working": {
        "width": 469,
        "height": 720,
        "scale": 0.36
      },
      "mask": {
        "coverage_pct": 40.05,
        "components": 16,
        "detection_boxes": 30,
        "flat_fill_pct": 0.0
      },
      "detected_text": [
        {
          "text": "NEW YORK TIMESBESTSELLER",
          "conf": 0.888,
          "box": [
            [
              271.0,
              114.0
            ],
            [
              914.0,
              114.0
            ],
            [
              914.0,
              142.0
            ],
            [
              271.0,
              142.0
            ]
          ]
        },
        {
          "text": "ALICE",
          "conf": 0.802,
          "box": [
            [
              154.0,
              177.0
            ],
            [
              996.0,
              182.0
            ],
            [
              995.0,
              408.0
            ],
            [
              153.0,
              403.0
            ]
          ]
        },
        {
          "text": "THE MILLIOn-COPY",
          "conf": 0.731,
          "box": [
            [
              1218.0,
              331.0
            ],
            [
              1266.0,
              331.0
            ],
            [
              1266.0,
              951.0
            ],
            [
              1218.0,
              951.0
            ]
          ]
        },
        {
          "text": "FEENEY",
          "conf": 0.789,
          "box": [
            [
              32.0,
              484.0
            ],
            [
              1138.0,
              494.0
            ],
            [
              1136.0,
              717.0
            ],
            [
              30.0,
              707.0
            ]
          ]
        },
        {
          "text": "\"Feeney lives up to her reputation",
          "conf": 0.953,
          "box": [
            [
              604.0,
              766.0
            ],
            [
              1072.0,
              770.0
            ],
            [
              1072.0,
              804.0
            ],
            [
              603.0,
              800.0
            ]
          ]
        },
        {
          "text": "as the 'queen of the twist:'",
          "conf": 0.88,
          "box": [
            [
              645.0,
              809.0
            ],
            [
              1006.0,
              809.0
            ],
            [
              1006.0,
              837.0
            ],
            [
              645.0,
              837.0
            ]
          ]
        },
        {
          "text": "This page-turner will keep you guessing.\"",
          "conf": 0.896,
          "box": [
            [
              563.0,
              842.0
            ],
            [
              1128.0,
              842.0
            ],
            [
              1128.0,
              879.0
            ],
            [
              563.0,
              879.0
            ]
          ]
        },
        {
          "text": "-REALSIMPLE",
          "conf": 0.811,
          "box": [
            [
              723.0,
              884.0
            ],
            [
              966.0,
              884.0
            ],
            [
              966.0,
              909.0
            ],
            [
              723.0,
              909.0
            ]
          ]
        },
        {
          "text": "BESTSELLING AUTHOR",
          "conf": 0.867,
          "box": [
            [
              1215.0,
              963.0
            ],
            [
              1263.0,
              962.0
            ],
            [
              1266.0,
              1671.0
            ],
            [
              1218.0,
              1671.0
            ]
          ]
        },
        {
          "text": "ROCK",
          "conf": 0.789,
          "box": [
            [
              183.0,
              1098.0
            ],
            [
              788.0,
              1088.0
            ],
            [
              791.0,
              1259.0
            ],
            [
              186.0,
              1270.0
            ]
          ]
        },
        {
          "text": "PAPER",
          "conf": 0.817,
          "box": [
            [
              450.0,
              1386.0
            ],
            [
              1128.0,
              1389.0
            ],
            [
              1127.0,
              1545.0
            ],
            [
              449.0,
              1542.0
            ]
          ]
        },
        {
          "text": "SCISSORS",
          "conf": 0.878,
          "box": [
            [
              84.0,
              1677.0
            ],
            [
              1102.0,
              1677.0
            ],
            [
              1102.0,
              1831.0
            ],
            [
              84.0,
              1831.0
            ]
          ]
        },
        {
          "text": "A NOVEL",
          "conf": 0.804,
          "box": [
            [
              132.0,
              1885.0
            ],
            [
              374.0,
              1885.0
            ],
            [
              374.0,
              1923.0
            ],
            [
              132.0,
              1923.0
            ]
          ]
        }
      ],
      "crop_options": {
        "text_free": null,
        "text_free_ocr_checks": [],
        "inpaint_visual": {
          "box": [
            285,
            0,
            159,
            720
          ],
          "coverage": 0.0,
          "luma_std": 45.91,
          "edge_density": 0.1674,
          "non_dark": 1.0,
          "salience": 15.3,
          "score": 3.2825
        }
      },
      "qa": {
        "chosen": {
          "mask_coverage_pct": 43.05,
          "crop_mask_coverage_pct": 49.793,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 45.44,
            "luma_p5": 90.0,
            "luma_p95": 238.0,
            "non_dark_pct": 100.0,
            "edge_density": 0.2084,
            "laplacian_var": 4657.2,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.875,
          "seam": {
            "seam_ratio": 0.76,
            "inside_vs_ring_delta_e": 31.5,
            "inside_ring_std_ratio": 1.59,
            "boundary_px": 18825
          },
          "score": 3.2825
        },
        "text_free": null,
        "inpaint": {
          "mask_coverage_pct": 43.05,
          "crop_mask_coverage_pct": 49.793,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 45.44,
            "luma_p5": 90.0,
            "luma_p95": 238.0,
            "non_dark_pct": 100.0,
            "edge_density": 0.2084,
            "laplacian_var": 4657.2,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.875,
          "seam": {
            "seam_ratio": 0.76,
            "inside_vs_ring_delta_e": 31.5,
            "inside_ring_std_ratio": 1.59,
            "boundary_px": 18825
          },
          "score": 3.2825
        }
      },
      "final": {
        "route": "inpaint",
        "verdict": "review",
        "spine": "assets/rps/spine.jpg",
        "spine_2x": "assets/rps/spine-2x.jpg",
        "fallback_spine": "assets/rps/fallback-spine.jpg",
        "crop_box_work": [
          285,
          0,
          159,
          720
        ],
        "mask_coverage_in_crop_pct": 49.793
      },
      "label": "Rock Paper Scissors",
      "role": "Hard integrated display type"
    },
    {
      "slug": "harry-potter",
      "book": {
        "title": "Harry Potter and the Philosopher's Stone",
        "author": "J.K. Rowling",
        "pages": 223,
        "cover": "../v7/assets/source/harry-potter.jpg"
      },
      "generated": "2026-11-26T17:41:13.090606+00:00",
      "route": "text-free crop",
      "verdict": "pass",
      "decision_reasons": [
        "zero mask coverage, no residual OCR, structure at spine scale"
      ],
      "manual_intervention": 0,
      "model": {
        "text_detector": "PP-OCRv3 DBNet (rapidocr_onnxruntime, ONNX, CPU)",
        "text_remover": "LaMa big-lama (simple-lama-inpainting, CPU) + sampled flat fill",
        "ocr_qa": "PP-OCRv3 recogniser",
        "crop_search": "integral-image spine-aspect scan + residual OCR",
        "generative_diffusion": "not used"
      },
      "runtime_s": {
        "detection": 3.23,
        "mask_total": 3.36,
        "inpaint_flat": 0.02,
        "inpaint_lama": 16.97,
        "crop_search": 0.45,
        "total": 28.38
      },
      "source": {
        "width": 420,
        "height": 621
      },
      "working": {
        "width": 420,
        "height": 621,
        "scale": 1.0
      },
      "mask": {
        "coverage_pct": 37.4,
        "components": 9,
        "detection_boxes": 14,
        "flat_fill_pct": 2.0
      },
      "detected_text": [
        {
          "text": "HARRY",
          "conf": 0.8,
          "box": [
            [
              94.0,
              41.0
            ],
            [
              941.0,
              41.0
            ],
            [
              941.0,
              199.0
            ],
            [
              94.0,
              199.0
            ]
          ]
        },
        {
          "text": "POTTER",
          "conf": 0.853,
          "box": [
            [
              80.0,
              205.0
            ],
            [
              949.0,
              203.0
            ],
            [
              950.0,
              360.0
            ],
            [
              81.0,
              362.0
            ]
          ]
        },
        {
          "text": "and tbe Pbilosopber's Stone",
          "conf": 0.805,
          "box": [
            [
              123.0,
              373.0
            ],
            [
              908.0,
              375.0
            ],
            [
              908.0,
              434.0
            ],
            [
              123.0,
              432.0
            ]
          ]
        },
        {
          "text": "J.K.ROWLING",
          "conf": 0.8,
          "box": [
            [
              320.0,
              459.0
            ],
            [
              729.0,
              459.0
            ],
            [
              729.0,
              498.0
            ],
            [
              320.0,
              498.0
            ]
          ]
        },
        {
          "text": "15",
          "conf": 0.666,
          "box": [
            [
              752.0,
              632.0
            ],
            [
              820.0,
              632.0
            ],
            [
              820.0,
              684.0
            ],
            [
              752.0,
              684.0
            ]
          ]
        },
        {
          "text": "YLA&SOE",
          "conf": 0.701,
          "box": [
            [
              741.0,
              683.0
            ],
            [
              836.0,
              685.0
            ],
            [
              835.0,
              706.0
            ],
            [
              741.0,
              704.0
            ]
          ]
        },
        {
          "text": "HARRY",
          "conf": 0.735,
          "box": [
            [
              709.0,
              712.0
            ],
            [
              849.0,
              712.0
            ],
            [
              849.0,
              743.0
            ],
            [
              709.0,
              743.0
            ]
          ]
        },
        {
          "text": "POTTER",
          "conf": 0.85,
          "box": [
            [
              709.0,
              756.0
            ],
            [
              859.0,
              756.0
            ],
            [
              859.0,
              790.0
            ],
            [
              709.0,
              790.0
            ]
          ]
        },
        {
          "text": "MAGIC",
          "conf": 0.718,
          "box": [
            [
              742.0,
              802.0
            ],
            [
              829.0,
              802.0
            ],
            [
              829.0,
              826.0
            ],
            [
              742.0,
              826.0
            ]
          ]
        },
        {
          "text": "HOGWARTS",
          "conf": 0.687,
          "box": [
            [
              268.0,
              955.0
            ],
            [
              651.0,
              908.0
            ],
            [
              661.0,
              990.0
            ],
            [
              278.0,
              1037.0
            ]
          ]
        },
        {
          "text": "EXPRESS",
          "conf": 0.796,
          "box": [
            [
              276.0,
              1048.0
            ],
            [
              649.0,
              1009.0
            ],
            [
              658.0,
              1101.0
            ],
            [
              285.0,
              1140.0
            ]
          ]
        },
        {
          "text": "TRIPLESMARTIESGOLD AWARD WINNER",
          "conf": 0.917,
          "box": [
            [
              107.0,
              1536.0
            ],
            [
              932.0,
              1536.0
            ],
            [
              932.0,
              1565.0
            ],
            [
              107.0,
              1565.0
            ]
          ]
        }
      ],
      "crop_options": {
        "text_free": {
          "box": [
            340,
            206,
            80,
            363
          ],
          "coverage": 0.00069,
          "luma_std": 45.17,
          "edge_density": 0.2161,
          "non_dark": 1.0,
          "salience": 23.72,
          "score": 3.1991,
          "ocr": []
        },
        "text_free_ocr_checks": [
          {
            "box": [
              340,
              206,
              80,
              363
            ],
            "ocr": []
          }
        ],
        "inpaint_visual": {
          "box": [
            265,
            0,
            132,
            600
          ],
          "coverage": 0.0,
          "luma_std": 51.89,
          "edge_density": 0.1366,
          "non_dark": 0.977,
          "salience": 18.06,
          "score": 3.3382
        }
      },
      "qa": {
        "chosen": {
          "mask_coverage_pct": 38.65,
          "crop_mask_coverage_pct": 0.069,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 45.01,
            "luma_p5": 93.0,
            "luma_p95": 228.0,
            "non_dark_pct": 100.0,
            "edge_density": 0.2388,
            "laplacian_var": 4661.0,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.057,
          "seam": {
            "seam_ratio": 0.79,
            "inside_vs_ring_delta_e": 54.4,
            "inside_ring_std_ratio": 0.57,
            "boundary_px": 6034
          },
          "score": 3.1991
        },
        "text_free": {
          "mask_coverage_pct": 38.65,
          "crop_mask_coverage_pct": 0.069,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 45.01,
            "luma_p5": 93.0,
            "luma_p95": 228.0,
            "non_dark_pct": 100.0,
            "edge_density": 0.2388,
            "laplacian_var": 4661.0,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.057,
          "seam": {
            "seam_ratio": 0.79,
            "inside_vs_ring_delta_e": 54.4,
            "inside_ring_std_ratio": 0.57,
            "boundary_px": 6034
          },
          "score": 3.1991
        },
        "inpaint": {
          "mask_coverage_pct": 38.65,
          "crop_mask_coverage_pct": 37.495,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 51.61,
            "luma_p5": 82.0,
            "luma_p95": 219.0,
            "non_dark_pct": 97.9,
            "edge_density": 0.1934,
            "laplacian_var": 6000.4,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.056,
          "seam": {
            "seam_ratio": 0.79,
            "inside_vs_ring_delta_e": 54.4,
            "inside_ring_std_ratio": 0.57,
            "boundary_px": 6034
          },
          "score": 3.3382
        }
      },
      "final": {
        "route": "text-free crop",
        "verdict": "pass",
        "spine": "assets/harry-potter/spine.jpg",
        "spine_2x": "assets/harry-potter/spine-2x.jpg",
        "fallback_spine": "assets/harry-potter/fallback-spine.jpg",
        "crop_box_work": [
          340,
          206,
          80,
          363
        ],
        "mask_coverage_in_crop_pct": 0.069
      },
      "label": "Harry Potter and the Philosopher's Stone",
      "role": "Popular cover \u00b7 text-free crop"
    },
    {
      "slug": "hunger-games",
      "book": {
        "title": "The Hunger Games",
        "author": "Suzanne Collins",
        "pages": 374,
        "cover": "../v7/assets/source/the-hunger-games.jpg"
      },
      "generated": "2026-11-26T17:41:39.676040+00:00",
      "route": "text-free crop",
      "verdict": "pass",
      "decision_reasons": [
        "zero mask coverage, no residual OCR, structure at spine scale"
      ],
      "manual_intervention": 0,
      "model": {
        "text_detector": "PP-OCRv3 DBNet (rapidocr_onnxruntime, ONNX, CPU)",
        "text_remover": "LaMa big-lama (simple-lama-inpainting, CPU) + sampled flat fill",
        "ocr_qa": "PP-OCRv3 recogniser",
        "crop_search": "integral-image spine-aspect scan + residual OCR",
        "generative_diffusion": "not used"
      },
      "runtime_s": {
        "detection": 3.27,
        "mask_total": 3.34,
        "inpaint_flat": 0.01,
        "inpaint_lama": 13.1,
        "crop_search": 0.56,
        "total": 23.93
      },
      "source": {
        "width": 330,
        "height": 500
      },
      "working": {
        "width": 330,
        "height": 500,
        "scale": 1.0
      },
      "mask": {
        "coverage_pct": 26.02,
        "components": 2,
        "detection_boxes": 15,
        "flat_fill_pct": 7.3
      },
      "detected_text": [
        {
          "text": "THE",
          "conf": 0.574,
          "box": [
            [
              103.0,
              57.0
            ],
            [
              328.0,
              57.0
            ],
            [
              328.0,
              138.0
            ],
            [
              103.0,
              138.0
            ]
          ]
        },
        {
          "text": "HUNGER",
          "conf": 0.819,
          "box": [
            [
              43.0,
              153.0
            ],
            [
              1009.0,
              148.0
            ],
            [
              1010.0,
              299.0
            ],
            [
              44.0,
              304.0
            ]
          ]
        },
        {
          "text": "GAmES",
          "conf": 0.557,
          "box": [
            [
              46.0,
              309.0
            ],
            [
              880.0,
              314.0
            ],
            [
              879.0,
              462.0
            ],
            [
              45.0,
              457.0
            ]
          ]
        },
        {
          "text": "NeulitThweBestdllingAuthot",
          "conf": 0.58,
          "box": [
            [
              580.0,
              1118.0
            ],
            [
              990.0,
              1123.0
            ],
            [
              990.0,
              1153.0
            ],
            [
              580.0,
              1148.0
            ]
          ]
        },
        {
          "text": "SUZANNE",
          "conf": 0.837,
          "box": [
            [
              575.0,
              1163.0
            ],
            [
              992.0,
              1163.0
            ],
            [
              992.0,
              1272.0
            ],
            [
              575.0,
              1272.0
            ]
          ]
        },
        {
          "text": "COLLINS",
          "conf": 0.86,
          "box": [
            [
              576.0,
              1292.0
            ],
            [
              995.0,
              1292.0
            ],
            [
              995.0,
              1397.0
            ],
            [
              576.0,
              1397.0
            ]
          ]
        }
      ],
      "crop_options": {
        "text_free": {
          "box": [
            51,
            156,
            76,
            344
          ],
          "coverage": 0.0,
          "luma_std": 54.46,
          "edge_density": 0.0882,
          "non_dark": 0.435,
          "salience": 28.01,
          "score": 3.202,
          "ocr": []
        },
        "text_free_ocr_checks": [
          {
            "box": [
              51,
              156,
              76,
              344
            ],
            "ocr": []
          }
        ],
        "inpaint_visual": {
          "box": [
            53,
            0,
            110,
            500
          ],
          "coverage": 0.0,
          "luma_std": 47.67,
          "edge_density": 0.0604,
          "non_dark": 0.292,
          "salience": 19.9,
          "score": 3.225
        }
      },
      "qa": {
        "chosen": {
          "mask_coverage_pct": 27.44,
          "crop_mask_coverage_pct": 0.0,
          "art_residual_ocr": [
            {
              "text": "Thwoe Blest",
              "conf": 0.56,
              "box": [
                [
                  694.0,
                  1120.0
                ],
                [
                  847.0,
                  1120.0
                ],
                [
                  847.0,
                  1150.0
                ],
                [
                  694.0,
                  1150.0
                ]
              ]
            }
          ],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 54.35,
            "luma_p5": 30.0,
            "luma_p95": 184.0,
            "non_dark_pct": 43.6,
            "edge_density": 0.116,
            "laplacian_var": 2060.7,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.971,
          "seam": {
            "seam_ratio": 1.17,
            "inside_vs_ring_delta_e": 9.9,
            "inside_ring_std_ratio": 0.92,
            "boundary_px": 4029
          },
          "score": 3.202
        },
        "text_free": {
          "mask_coverage_pct": 27.44,
          "crop_mask_coverage_pct": 0.0,
          "art_residual_ocr": [
            {
              "text": "Thwoe Blest",
              "conf": 0.56,
              "box": [
                [
                  694.0,
                  1120.0
                ],
                [
                  847.0,
                  1120.0
                ],
                [
                  847.0,
                  1150.0
                ],
                [
                  694.0,
                  1150.0
                ]
              ]
            }
          ],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 54.35,
            "luma_p5": 30.0,
            "luma_p95": 184.0,
            "non_dark_pct": 43.6,
            "edge_density": 0.116,
            "laplacian_var": 2060.7,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.971,
          "seam": {
            "seam_ratio": 1.17,
            "inside_vs_ring_delta_e": 9.9,
            "inside_ring_std_ratio": 0.92,
            "boundary_px": 4029
          },
          "score": 3.202
        },
        "inpaint": {
          "mask_coverage_pct": 27.44,
          "crop_mask_coverage_pct": 24.618,
          "art_residual_ocr": [
            {
              "text": "Thwoe Blest",
              "conf": 0.56,
              "box": [
                [
                  694.0,
                  1120.0
                ],
                [
                  847.0,
                  1120.0
                ],
                [
                  847.0,
                  1150.0
                ],
                [
                  694.0,
                  1150.0
                ]
              ]
            }
          ],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 47.58,
            "luma_p5": 31.0,
            "luma_p95": 169.0,
            "non_dark_pct": 29.3,
            "edge_density": 0.1098,
            "laplacian_var": 3171.4,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.916,
          "seam": {
            "seam_ratio": 1.17,
            "inside_vs_ring_delta_e": 9.9,
            "inside_ring_std_ratio": 0.92,
            "boundary_px": 4029
          },
          "score": 3.225
        }
      },
      "final": {
        "route": "text-free crop",
        "verdict": "pass",
        "spine": "assets/hunger-games/spine.jpg",
        "spine_2x": "assets/hunger-games/spine-2x.jpg",
        "fallback_spine": "assets/hunger-games/fallback-spine.jpg",
        "crop_box_work": [
          51,
          156,
          76,
          344
        ],
        "mask_coverage_in_crop_pct": 0.0
      },
      "label": "The Hunger Games",
      "role": "Popular cover \u00b7 text-free crop"
    },
    {
      "slug": "whisper-man",
      "book": {
        "title": "The Whisper Man",
        "author": "Alex North",
        "pages": 368,
        "cover": "../v4-generative/assets/whisper-man-cover.jpg"
      },
      "generated": "2026-11-26T17:42:14.360416+00:00",
      "route": "text-free crop",
      "verdict": "pass",
      "decision_reasons": [
        "zero mask coverage, no residual OCR, structure at spine scale"
      ],
      "manual_intervention": 0,
      "model": {
        "text_detector": "PP-OCRv3 DBNet (rapidocr_onnxruntime, ONNX, CPU)",
        "text_remover": "LaMa big-lama (simple-lama-inpainting, CPU) + sampled flat fill",
        "ocr_qa": "PP-OCRv3 recogniser",
        "crop_search": "integral-image spine-aspect scan + residual OCR",
        "generative_diffusion": "not used"
      },
      "runtime_s": {
        "detection": 3.31,
        "mask_total": 3.47,
        "inpaint_flat": 0.03,
        "inpaint_lama": 19.58,
        "crop_search": 0.49,
        "total": 31.94
      },
      "source": {
        "width": 1303,
        "height": 2000
      },
      "working": {
        "width": 469,
        "height": 720,
        "scale": 0.36
      },
      "mask": {
        "coverage_pct": 14.07,
        "components": 19,
        "detection_boxes": 13,
        "flat_fill_pct": 5.8
      },
      "detected_text": [
        {
          "text": "THE SUNDAYTIMES BESTSELLER",
          "conf": 0.861,
          "box": [
            [
              192.0,
              74.0
            ],
            [
              1118.0,
              74.0
            ],
            [
              1118.0,
              111.0
            ],
            [
              192.0,
              111.0
            ]
          ]
        },
        {
          "text": "IF YOU LEAVE A DOOR HALF-OPEN,",
          "conf": 0.866,
          "box": [
            [
              338.0,
              171.0
            ],
            [
              960.0,
              173.0
            ],
            [
              960.0,
              205.0
            ],
            [
              338.0,
              204.0
            ]
          ]
        },
        {
          "text": "SOON YOU'LL HEAR THE WHISPERS SPOKEN",
          "conf": 0.905,
          "box": [
            [
              255.0,
              231.0
            ],
            [
              1044.0,
              231.0
            ],
            [
              1044.0,
              260.0
            ],
            [
              255.0,
              260.0
            ]
          ]
        },
        {
          "text": "The best",
          "conf": 0.815,
          "box": [
            [
              945.0,
              461.0
            ],
            [
              1095.0,
              465.0
            ],
            [
              1094.0,
              500.0
            ],
            [
              944.0,
              496.0
            ]
          ]
        },
        {
          "text": "crime novel of",
          "conf": 0.88,
          "box": [
            [
              904.0,
              505.0
            ],
            [
              1136.0,
              502.0
            ],
            [
              1137.0,
              536.0
            ],
            [
              905.0,
              539.0
            ]
          ]
        },
        {
          "text": "the decade'",
          "conf": 0.834,
          "box": [
            [
              927.0,
              543.0
            ],
            [
              1107.0,
              543.0
            ],
            [
              1107.0,
              576.0
            ],
            [
              927.0,
              576.0
            ]
          ]
        },
        {
          "text": "Steve",
          "conf": 0.83,
          "box": [
            [
              974.0,
              581.0
            ],
            [
              1065.0,
              581.0
            ],
            [
              1065.0,
              616.0
            ],
            [
              974.0,
              616.0
            ]
          ]
        },
        {
          "text": "Cavanagh",
          "conf": 0.875,
          "box": [
            [
              938.0,
              619.0
            ],
            [
              1098.0,
              621.0
            ],
            [
              1098.0,
              661.0
            ],
            [
              938.0,
              659.0
            ]
          ]
        },
        {
          "text": "THE",
          "conf": 0.748,
          "box": [
            [
              587.0,
              1648.0
            ],
            [
              721.0,
              1648.0
            ],
            [
              721.0,
              1696.0
            ],
            [
              587.0,
              1696.0
            ]
          ]
        },
        {
          "text": "WHISPERMAN",
          "conf": 0.889,
          "box": [
            [
              94.0,
              1725.0
            ],
            [
              1224.0,
              1722.0
            ],
            [
              1224.0,
              1806.0
            ],
            [
              94.0,
              1809.0
            ]
          ]
        },
        {
          "text": "ALEX NORTH",
          "conf": 0.858,
          "box": [
            [
              323.0,
              1844.0
            ],
            [
              990.0,
              1844.0
            ],
            [
              990.0,
              1905.0
            ],
            [
              323.0,
              1905.0
            ]
          ]
        }
      ],
      "crop_options": {
        "text_free": {
          "box": [
            183,
            168,
            87,
            396
          ],
          "coverage": 0.0,
          "luma_std": 40.91,
          "edge_density": 0.1839,
          "non_dark": 0.441,
          "salience": 18.27,
          "score": 3.0435,
          "ocr": []
        },
        "text_free_ocr_checks": [
          {
            "box": [
              183,
              168,
              87,
              396
            ],
            "ocr": []
          }
        ],
        "inpaint_visual": {
          "box": [
            183,
            168,
            87,
            396
          ],
          "coverage": 0.0,
          "luma_std": 40.91,
          "edge_density": 0.1839,
          "non_dark": 0.441,
          "salience": 18.27,
          "score": 3.0435
        }
      },
      "qa": {
        "chosen": {
          "mask_coverage_pct": 15.46,
          "crop_mask_coverage_pct": 0.0,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 40.87,
            "luma_p5": 4.0,
            "luma_p95": 132.0,
            "non_dark_pct": 43.8,
            "edge_density": 0.2041,
            "laplacian_var": 5140.7,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.457,
          "seam": {
            "seam_ratio": 1.21,
            "inside_vs_ring_delta_e": 7.6,
            "inside_ring_std_ratio": 0.73,
            "boundary_px": 8965
          },
          "score": 3.0435
        },
        "text_free": {
          "mask_coverage_pct": 15.46,
          "crop_mask_coverage_pct": 0.0,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 40.87,
            "luma_p5": 4.0,
            "luma_p95": 132.0,
            "non_dark_pct": 43.8,
            "edge_density": 0.2041,
            "laplacian_var": 5140.7,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.457,
          "seam": {
            "seam_ratio": 1.21,
            "inside_vs_ring_delta_e": 7.6,
            "inside_ring_std_ratio": 0.73,
            "boundary_px": 8965
          },
          "score": 3.0435
        },
        "inpaint": {
          "mask_coverage_pct": 15.46,
          "crop_mask_coverage_pct": 0.0,
          "art_residual_ocr": [],
          "crop_residual_ocr": [],
          "spine_residual_ocr": [],
          "spine": {
            "luma_std": 40.87,
            "luma_p5": 4.0,
            "luma_p95": 132.0,
            "non_dark_pct": 43.8,
            "edge_density": 0.2041,
            "laplacian_var": 5140.7,
            "width_px": 52,
            "height_px": 236
          },
          "palette_corr": 0.457,
          "seam": {
            "seam_ratio": 1.21,
            "inside_vs_ring_delta_e": 7.6,
            "inside_ring_std_ratio": 0.73,
            "boundary_px": 8965
          },
          "score": 3.0435
        }
      },
      "final": {
        "route": "text-free crop",
        "verdict": "pass",
        "spine": "assets/whisper-man/spine.jpg",
        "spine_2x": "assets/whisper-man/spine-2x.jpg",
        "fallback_spine": "assets/whisper-man/fallback-spine.jpg",
        "crop_box_work": [
          183,
          168,
          87,
          396
        ],
        "mask_coverage_in_crop_pct": 0.0
      },
      "label": "The Whisper Man",
      "role": "Unseen holdout \u00b7 no tuning"
    }
  ]
};
