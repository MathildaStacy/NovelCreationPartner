package com.novelcreationpartner.transport

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class ModelTransportPackage : BaseReactPackage() {
  override fun getModule(name: String, context: ReactApplicationContext): NativeModule? =
    if (name == ModelTransportModule.NAME) ModelTransportModule(context) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(ModelTransportModule.NAME to ReactModuleInfo(
      ModelTransportModule.NAME, ModelTransportModule.NAME, false, false, false, true
    ))
  }
}
