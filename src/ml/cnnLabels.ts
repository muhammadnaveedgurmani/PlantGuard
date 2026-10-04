// AUTO-GENERATED from cnn-training labels.json (38 PlantVillage classes).
// Do not hand-edit: regenerate with the same script if labels change.

export type CnnClassInfo = { plant: string; disease: string; healthy: boolean }

export const CNN_CLASSES: string[] = [
  "Apple___Apple_scab",
  "Apple___Black_rot",
  "Apple___Cedar_apple_rust",
  "Apple___healthy",
  "Blueberry___healthy",
  "Cherry_(including_sour)___Powdery_mildew",
  "Cherry_(including_sour)___healthy",
  "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
  "Corn_(maize)___Common_rust_",
  "Corn_(maize)___Northern_Leaf_Blight",
  "Corn_(maize)___healthy",
  "Grape___Black_rot",
  "Grape___Esca_(Black_Measles)",
  "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)",
  "Grape___healthy",
  "Orange___Haunglongbing_(Citrus_greening)",
  "Peach___Bacterial_spot",
  "Peach___healthy",
  "Pepper,_bell___Bacterial_spot",
  "Pepper,_bell___healthy",
  "Potato___Early_blight",
  "Potato___Late_blight",
  "Potato___healthy",
  "Raspberry___healthy",
  "Soybean___healthy",
  "Squash___Powdery_mildew",
  "Strawberry___Leaf_scorch",
  "Strawberry___healthy",
  "Tomato___Bacterial_spot",
  "Tomato___Early_blight",
  "Tomato___Late_blight",
  "Tomato___Leaf_Mold",
  "Tomato___Septoria_leaf_spot",
  "Tomato___Spider_mites Two-spotted_spider_mite",
  "Tomato___Target_Spot",
  "Tomato___Tomato_Yellow_Leaf_Curl_Virus",
  "Tomato___Tomato_mosaic_virus",
  "Tomato___healthy",
]

export const CNN_CLASS_INFO: Record<string, CnnClassInfo> = {
  "Apple___Apple_scab": { plant: "Apple", disease: "Apple Scab", healthy: false },
  "Apple___Black_rot": { plant: "Apple", disease: "Black Rot", healthy: false },
  "Apple___Cedar_apple_rust": { plant: "Apple", disease: "Cedar Apple Rust", healthy: false },
  "Apple___healthy": { plant: "Apple", disease: "Healthy", healthy: true },
  "Blueberry___healthy": { plant: "Blueberry", disease: "Healthy", healthy: true },
  "Cherry_(including_sour)___Powdery_mildew": { plant: "Cherry", disease: "Powdery Mildew", healthy: false },
  "Cherry_(including_sour)___healthy": { plant: "Cherry", disease: "Healthy", healthy: true },
  "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot": { plant: "Corn", disease: "Cercospora Leaf Spot Gray Leaf Spot", healthy: false },
  "Corn_(maize)___Common_rust_": { plant: "Corn", disease: "Common Rust", healthy: false },
  "Corn_(maize)___Northern_Leaf_Blight": { plant: "Corn", disease: "Northern Leaf Blight", healthy: false },
  "Corn_(maize)___healthy": { plant: "Corn", disease: "Healthy", healthy: true },
  "Grape___Black_rot": { plant: "Grape", disease: "Black Rot", healthy: false },
  "Grape___Esca_(Black_Measles)": { plant: "Grape", disease: "Esca", healthy: false },
  "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)": { plant: "Grape", disease: "Leaf Blight", healthy: false },
  "Grape___healthy": { plant: "Grape", disease: "Healthy", healthy: true },
  "Orange___Haunglongbing_(Citrus_greening)": { plant: "Orange", disease: "Haunglongbing", healthy: false },
  "Peach___Bacterial_spot": { plant: "Peach", disease: "Bacterial Spot", healthy: false },
  "Peach___healthy": { plant: "Peach", disease: "Healthy", healthy: true },
  "Pepper,_bell___Bacterial_spot": { plant: "Pepper, bell", disease: "Bacterial Spot", healthy: false },
  "Pepper,_bell___healthy": { plant: "Pepper, bell", disease: "Healthy", healthy: true },
  "Potato___Early_blight": { plant: "Potato", disease: "Early Blight", healthy: false },
  "Potato___Late_blight": { plant: "Potato", disease: "Late Blight", healthy: false },
  "Potato___healthy": { plant: "Potato", disease: "Healthy", healthy: true },
  "Raspberry___healthy": { plant: "Raspberry", disease: "Healthy", healthy: true },
  "Soybean___healthy": { plant: "Soybean", disease: "Healthy", healthy: true },
  "Squash___Powdery_mildew": { plant: "Squash", disease: "Powdery Mildew", healthy: false },
  "Strawberry___Leaf_scorch": { plant: "Strawberry", disease: "Leaf Scorch", healthy: false },
  "Strawberry___healthy": { plant: "Strawberry", disease: "Healthy", healthy: true },
  "Tomato___Bacterial_spot": { plant: "Tomato", disease: "Bacterial Spot", healthy: false },
  "Tomato___Early_blight": { plant: "Tomato", disease: "Early Blight", healthy: false },
  "Tomato___Late_blight": { plant: "Tomato", disease: "Late Blight", healthy: false },
  "Tomato___Leaf_Mold": { plant: "Tomato", disease: "Leaf Mold", healthy: false },
  "Tomato___Septoria_leaf_spot": { plant: "Tomato", disease: "Septoria Leaf Spot", healthy: false },
  "Tomato___Spider_mites Two-spotted_spider_mite": { plant: "Tomato", disease: "Spider Mites Two-spotted Spider Mite", healthy: false },
  "Tomato___Target_Spot": { plant: "Tomato", disease: "Target Spot", healthy: false },
  "Tomato___Tomato_Yellow_Leaf_Curl_Virus": { plant: "Tomato", disease: "Tomato Yellow Leaf Curl Virus", healthy: false },
  "Tomato___Tomato_mosaic_virus": { plant: "Tomato", disease: "Tomato Mosaic Virus", healthy: false },
  "Tomato___healthy": { plant: "Tomato", disease: "Healthy", healthy: true },
}

const CNN_THRESHOLD_DEFAULT = 0.70

/** Build a validateDiagnosisRaw-compatible raw object from a CNN prediction. */
export function cnnLabelToDiagnosisRaw(label: string, confidence01: number) {
  const info = CNN_CLASS_INFO[label]
  if (!info) return null
  const confidence = Math.round(Math.max(0, Math.min(1, confidence01)) * 100)
  return {
    is_leaf: true,
    is_healthy: info.healthy,
    plant_name: info.plant,
    disease_name: info.disease,
    confidence,
    severity: info.healthy ? "None" : "Moderate",
    symptoms: [],
    spread: [],
    treatment: [],
    prevention: [],
    notes: info.healthy
      ? "On-device CNN model result (PlantGuard CNN v1). No disease signs detected."
      : "On-device CNN model result (PlantGuard CNN v1). Confirm with an expert for critical crops.",
    secondary_possibilities: []
  }
}

export { CNN_THRESHOLD_DEFAULT }
