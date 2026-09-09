Pod::Spec.new do |s|
  s.name             = 'HybridSampleHost'
  s.version          = '1.0.0'
  s.summary          = 'Native SDK owner for the Cocos Creator 3 Hybrid sample.'
  s.homepage         = 'https://github.com/TrueWatchTech/datakit-cocos'
  s.license          = { :type => 'Apache-2.0' }
  s.author           = { 'TrueWatch' => 'support@truewatch.com' }
  s.source           = { :path => '.' }
  s.platform         = :ios, '12.0'
  s.source_files     = 'HybridSampleSDK.{h,m}', 'HybridSampleEnvironment.generated.h'
  s.public_header_files = 'HybridSampleSDK.h'
  s.requires_arc     = true
  s.dependency 'TrueWatchSDK/Agent', '1.6.8-alpha.2'
  s.dependency 'TrueWatchSDK/FTSessionReplay', '1.6.8-alpha.2'
end
