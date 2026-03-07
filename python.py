import tensorflow as tf
m = tf.keras.models.load_model("train/artifacts/best.keras")
m.save("models/latest/stone_classifier_best.h5")
print("saved models/latest/stone_classifier_best.h5")