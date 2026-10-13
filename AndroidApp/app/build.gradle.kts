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
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Bump versionCode when shipping a new APK; Android
        // refuses to install a new build over the old one if
        // versionCode is <= what's already on the device.
        // versionName is the human-readable label the user
        // sees in the app's About screen.
        versionCode = 5
        versionName = "1.3.1"
    }

    flavorDimensions += "variant"
    productFlavors {
        create("standard") {
            dimension = "variant"
            applicationId = "com.example.obdapp"
        }
        create("amapauto") {
            dimension = "variant"
            applicationId = "com.autonavi.amapauto"
        }
        create("androidauto") {
            dimension = "variant"
            applicationId = "com.example.obdapp.androidauto"
            targetSdk = 36
            minSdk = 26
        }
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
    testOptions {
        unitTests.isIncludeAndroidResources = true
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

kapt {
    arguments {
        arg("room.schemaLocation", "$projectDir/schemas")
    }
}

dependencies {
  "androidautoImplementation"("androidx.car.app:app:1.7.0")
  "androidautoImplementation"("androidx.car.app:app-projected:1.7.0")
  "testAndroidautoImplementation"("androidx.car.app:app-testing:1.7.0")
  implementation("androidx.core:core-ktx:1.12.0")
  implementation("androidx.appcompat:appcompat:1.2.0")

  // Room
  val roomVersion = "2.8.4"
  implementation("androidx.room:room-runtime:$roomVersion")
  implementation("androidx.room:room-ktx:$roomVersion")
  kapt("androidx.room:room-compiler:$roomVersion")


  // Coroutines
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.5.0")

  // Kotlin OBD API
  implementation("com.github.eltonvs:kotlin-obd-api:1.4.1")

  // QR Code generator
  implementation("com.google.zxing:core:3.5.3")

  // Testing
  testImplementation("junit:junit:4.13.2")
  testImplementation("androidx.test:core:1.5.0")
  testImplementation("org.robolectric:robolectric:4.11.1")
  androidTestImplementation("androidx.test.ext:junit:1.3.0")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
  androidTestImplementation("androidx.test:core:1.7.0")
  androidTestImplementation("androidx.test:runner:1.7.0")
  androidTestImplementation("androidx.test:rules:1.6.1")
}

configurations.all {
    resolutionStrategy {
        force("org.jetbrains.kotlinx:kotlinx-metadata-jvm:0.9.0")
    }
}
