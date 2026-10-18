package com.novelcreationpartner.files

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
class DocumentStorePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = when (name) { DocumentStoreModule.NAME -> DocumentStoreModule(reactContext); CoverStoreModule.NAME -> CoverStoreModule(reactContext); AppInfoModule.NAME -> AppInfoModule(reactContext); else -> null }
  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider { mapOf(
    DocumentStoreModule.NAME to ReactModuleInfo(DocumentStoreModule.NAME, DocumentStoreModule.NAME, false, false, false, true),
    CoverStoreModule.NAME to ReactModuleInfo(CoverStoreModule.NAME, CoverStoreModule.NAME, false, false, false, true),
    AppInfoModule.NAME to ReactModuleInfo(AppInfoModule.NAME, AppInfoModule.NAME, false, false, false, true)) }
}
