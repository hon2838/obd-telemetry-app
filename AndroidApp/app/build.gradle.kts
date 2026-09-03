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
        // Bump versionCode when shipping a new APK; Android
        // refuses to install a new build over the old one if
        // versionCode is <= what's already on the device.
        // versionName is the human-readable label the user
        // sees in the app's About screen.
        versionCode = 3
        versionName = "1.2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
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

  // QR Code generator
  implementation("com.google.zxing:core:3.5.3")

  // Testing
  testImplementation("junit:junit:4.13.2")
  androidTestImplementation("androidx.test.ext:junit:1.1.5")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}

configurations.all {
    resolutionStrategy {
        force("org.jetbrains.kotlinx:kotlinx-metadata-jvm:0.9.0")
    }
}
