Pod::Spec.new do |s|
  s.name             = 'FTCocosReplayBridge'
  s.version          = '0.1.0-alpha.7'
  s.summary          = 'TrueWatch Mobile SDK native bridge for Cocos Creator.'
  s.homepage         = 'https://github.com/TrueWatchTech/datakit-cocos'
  s.license          = { :type => 'Apache-2.0' }
  s.author           = { 'TrueWatch' => 'support@truewatch.com' }
  s.source           = { :path => '.' }
  s.platform         = :ios, '12.0'
  s.source_files     = 'FTCocosReplayBridge.{h,m}', 'FTCocosReplayImageJobs.{h,m}'
  s.public_header_files = 'FTCocosReplayBridge.h'
  s.requires_arc     = true
  # Cocos resolves FTCocosReplayBridge by class name at runtime, so no direct symbol
  # reference would otherwise keep the Objective-C category/class in the app.
  s.user_target_xcconfig = { 'OTHER_LDFLAGS' => '$(inherited) -ObjC' }
  s.dependency 'TrueWatchSDK/FTSessionReplay', '1.6.8-alpha.5'
  s.dependency 'TrueWatchSDK/Agent', '1.6.8-alpha.5'
end
