# Thread's own native modules for iOS (a local pod, so the Xcode project file
# does not need hand edits): ThreadBootInfo.
Pod::Spec.new do |s|
  s.name         = 'ThreadNative'
  s.version      = '1.0.0'
  s.summary      = 'Thread native modules'
  s.homepage     = 'https://threadapp.kr'
  s.license      = { :type => 'Proprietary' }
  s.author       = 'Thread'
  s.platforms    = { :ios => '15.1' }
  s.source       = { :path => '.' }
  s.source_files = '*.{h,m}'
  s.dependency 'React-Core'
end
