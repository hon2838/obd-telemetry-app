plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("kotlin-kapt")
}

android {
    namespace = "com.example.obdapp"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.example.obdapp"
        minSdk = 23
        targetSdk = 29
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = false
      aidl = false
      buildConfig = false
      shaders = false
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
  implementation("androidx.core:core-ktx:1.3.2")
  implementation("androidx.appcompat:appcompat:1.2.0")

  // Room
  val roomVersion = "2.8.4"
  implementation("androidx.room:room-runtime:$roomVersion")
  implementation("androidx.room:room-ktx:$roomVersion")
  kapt("androidx.room:room-compiler:$roomVersion")

  // WorkManager
  val workVersion = "2.7.0"
  implementation("androidx.work:work-runtime-ktx:$workVersion")

  // Coroutines
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.5.0")

  // Kotlin OBD API
  implementation("com.github.eltonvs:kotlin-obd-api:1.4.1")
}

configurations.all {
    resolutionStrategy {
        force("org.jetbrains.kotlinx:kotlinx-metadata-jvm:0.9.0")
    }
}
